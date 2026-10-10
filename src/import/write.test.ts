import { readFileSync } from "node:fs";
import { asc, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors, eventHistory, eventTags, events, overrides, tags } from "@/db/schema";
import { seedAdmins } from "@/db/seed-admins";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { importTockify } from "./import-tockify";
import type { ImportResult, ImportedEvent } from "./types";
import { writeImport } from "./write";

const feed = new Uint8Array(
  readFileSync(new URL("./__fixtures__/tockify-bikegr-2026-10-09.ics", import.meta.url)),
);
const fixture = importTockify(feed, { importDate: "2026-10-09" });

/** A fresh copy, so a test can change it. */
const fresh = (): ImportResult => structuredClone(fixture);

function oneTime(sourceId: string, patch: Partial<ImportedEvent> = {}): ImportedEvent {
  return {
    sourceId,
    calendar: "rides",
    title: `Event ${sourceId}`,
    description: "",
    location: null,
    tagSlugs: [],
    imageUrl: null,
    cta: null,
    rule: {
      eventId: sourceId,
      timing: { kind: "timed", start: "2026-10-20T18:00", end: "2026-10-20T20:00" },
      rrule: null,
      exdates: [],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    },
    ...patch,
  };
}

function small(eventsList: ImportedEvent[], tagList: ImportResult["tags"] = []): ImportResult {
  return {
    importDate: "2026-10-09",
    openEndedAfter: "2027-10-09",
    events: eventsList,
    overrides: [],
    tags: tagList,
    flags: [],
    series: [],
  };
}

async function counts(db: Db) {
  const n = async (table: typeof events | typeof overrides | typeof tags | typeof eventTags | typeof eventHistory) =>
    (await db.select({ n: count() }).from(table))[0].n;
  return {
    events: await n(events),
    overrides: await n(overrides),
    tags: await n(tags),
    eventTags: await n(eventTags),
    history: await n(eventHistory),
  };
}

async function eventBySource(db: Db, sourceId: string) {
  const [row] = await db.select().from(events).where(eq(events.sourceId, sourceId));
  return row;
}

async function tagSlugsOf(db: Db, eventId: string) {
  const rows = await db
    .select({ slug: tags.slug, calendar: tags.calendar })
    .from(eventTags)
    .innerJoin(tags, eq(tags.id, eventTags.tagId))
    .where(eq(eventTags.eventId, eventId))
    .orderBy(asc(tags.slug));
  return rows;
}

describe("import writer", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => close());

  it("first run inserts every Event, its Overrides, its Tags, and one history row for each Event", async () => {
    const report = await writeImport(db, fresh());
    const c = await counts(db);
    expect(report.inserted).toHaveLength(fixture.events.length);
    expect(report.failed).toEqual([]);
    expect(c.events).toBe(fixture.events.length);
    expect(c.overrides).toBe(fixture.overrides.length);
    expect(c.tags).toBe(fixture.tags.length);
    expect(c.eventTags).toBe(fixture.events.reduce((sum, e) => sum + e.tagSlugs.length, 0));
    expect(c.history).toBe(fixture.events.length);
    const history = await db.select().from(eventHistory);
    expect(history.every((h) => h.action === "import" && h.version === 1 && h.changedBy === null)).toBe(
      true,
    );
  });

  it("imported Events are approved, with no created_by and version 1", async () => {
    await writeImport(db, fresh());
    const rows = await db.select().from(events);
    expect(rows.every((r) => r.reviewStatus === "approved")).toBe(true);
    expect(rows.every((r) => r.createdBy === null && r.updatedBy === null)).toBe(true);
    expect(rows.every((r) => r.version === 1)).toBe(true);
    const wednesday = await eventBySource(db, "1");
    expect(wednesday.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("second run with the same feed changes nothing", async () => {
    await writeImport(db, fresh());
    const before = await db.select().from(events).orderBy(asc(events.sourceId));
    const overridesBefore = await db.select().from(overrides).orderBy(asc(overrides.originalStart));
    const report = await writeImport(db, fresh());
    expect(report.inserted).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.unchanged).toHaveLength(fixture.events.length);
    expect(await db.select().from(events).orderBy(asc(events.sourceId))).toEqual(before);
    expect(await db.select().from(overrides).orderBy(asc(overrides.originalStart))).toEqual(
      overridesBefore,
    );
    expect((await counts(db)).history).toBe(fixture.events.length);
  });

  it("changed title in the feed updates only that Event: version 2, one new history row", async () => {
    await writeImport(db, fresh());
    const changed = fresh();
    changed.events.find((e) => e.sourceId === "2")!.title = "Switchback Community Ride (new)";
    const report = await writeImport(db, changed);
    expect(report.updated.map((e) => e.sourceId)).toEqual(["2"]);
    expect(report.unchanged).toHaveLength(fixture.events.length - 1);
    const row = await eventBySource(db, "2");
    expect(row.title).toBe("Switchback Community Ride (new)");
    expect(row.version).toBe(2);
    const history = await db.select().from(eventHistory).where(eq(eventHistory.eventId, row.id));
    expect(history.map((h) => h.version).sort()).toEqual([1, 2]);
    expect((await counts(db)).history).toBe(fixture.events.length + 1);
  });

  it("changed Override updates only that Series and its Overrides", async () => {
    await writeImport(db, fresh());
    const changed = fresh();
    const override = changed.overrides.find((o) => o.eventId === "1")!;
    override.scheduleNote = "Rain";
    const report = await writeImport(db, changed);
    expect(report.updated.map((e) => e.sourceId)).toEqual(["1"]);
    const row = await eventBySource(db, "1");
    const stored = await db.select().from(overrides).where(eq(overrides.eventId, row.id));
    expect(stored.find((o) => o.originalStart === override.originalStart)?.scheduleNote).toBe("Rain");
  });

  it("an Override that is gone from the feed is deleted", async () => {
    await writeImport(db, fresh());
    const changed = fresh();
    changed.overrides = changed.overrides.filter((o) => o.eventId !== "1");
    await writeImport(db, changed);
    const row = await eventBySource(db, "1");
    expect(await db.select().from(overrides).where(eq(overrides.eventId, row.id))).toEqual([]);
    expect((await counts(db)).overrides).toBe(changed.overrides.length);
  });

  it("a changed Tag list replaces the Event's Tags", async () => {
    const first = small(
      [oneTime("100", { tagSlugs: ["race", "social"] })],
      [
        { calendar: "rides", name: "Race", slug: "race" },
        { calendar: "rides", name: "Social", slug: "social" },
        { calendar: "rides", name: "Gravel", slug: "gravel" },
      ],
    );
    await writeImport(db, first);
    const second = structuredClone(first);
    second.events[0].tagSlugs = ["gravel", "race"];
    const report = await writeImport(db, second);
    expect(report.updated).toHaveLength(1);
    const row = await eventBySource(db, "100");
    expect((await tagSlugsOf(db, row.id)).map((t) => t.slug)).toEqual(["gravel", "race"]);
  });

  it("fallback one-time Events keep their <eventId>/<startMinutes> Source IDs on the second run", async () => {
    const fallback = small([
      oneTime("70/29800000"),
      oneTime("70/29810080", {
        rule: { ...oneTime("x").rule, eventId: "70/29810080", timing: { kind: "timed", start: "2026-10-27T18:00", end: "2026-10-27T20:00" } },
      }),
    ]);
    await writeImport(db, fallback);
    const report = await writeImport(db, structuredClone(fallback));
    expect(report.unchanged.map((e) => e.sourceId).sort()).toEqual(["70/29800000", "70/29810080"]);
    const ids = (await db.select({ s: events.sourceId }).from(events)).map((r) => r.s).sort();
    expect(ids).toEqual(["70/29800000", "70/29810080"]);
  });

  it("Tags with the same slug in the two Calendars stay separate Tags", async () => {
    await writeImport(
      db,
      small(
        [
          oneTime("200", { calendar: "rides", tagSlugs: ["community"] }),
          oneTime("201", { calendar: "advocacy", tagSlugs: ["community"] }),
        ],
        [
          { calendar: "advocacy", name: "Community", slug: "community" },
          { calendar: "rides", name: "Community", slug: "community" },
        ],
      ),
    );
    const rows = await db.select().from(tags).orderBy(asc(tags.calendar));
    expect(rows.map((t) => [t.calendar, t.slug])).toEqual([
      ["rides", "community"],
      ["advocacy", "community"],
    ]);
    const rides = await eventBySource(db, "200");
    const advocacy = await eventBySource(db, "201");
    expect(await tagSlugsOf(db, rides.id)).toEqual([{ slug: "community", calendar: "rides" }]);
    expect(await tagSlugsOf(db, advocacy.id)).toEqual([{ slug: "community", calendar: "advocacy" }]);
  });

  it("an Editor's Tag rename is kept; the import links by slug", async () => {
    const result = small([oneTime("300", { tagSlugs: ["non-drop"] })], [
      { calendar: "rides", name: "Non-Drop", slug: "non-drop" },
    ]);
    await writeImport(db, result);
    await db.update(tags).set({ name: "No-drop ride" }).where(eq(tags.slug, "non-drop"));
    const changed = structuredClone(result);
    changed.events[0].title = "Changed";
    await writeImport(db, changed);
    const [tag] = await db.select().from(tags);
    expect(tag.name).toBe("No-drop ride");
    expect(await counts(db)).toMatchObject({ tags: 1, eventTags: 1 });
  });

  it("an Event changed by an Editor is overwritten and gives a warning", async () => {
    await seedAdmins(db);
    const [admin] = await db.select().from(editors).limit(1);
    const result = small([oneTime("400")]);
    await writeImport(db, result);
    await db.update(events).set({ title: "Edited by hand", updatedBy: admin.id }).where(eq(events.sourceId, "400"));
    const report = await writeImport(db, structuredClone(result));
    expect(report.updated.map((e) => e.sourceId)).toEqual(["400"]);
    expect(report.editorOverwrites).toEqual([{ sourceId: "400", title: "Event 400" }]);
    const row = await eventBySource(db, "400");
    expect(row.title).toBe("Event 400");
    expect(row.updatedBy).toBeNull();
  });

  it("Review status and soft delete set by an Editor stay after an update", async () => {
    await seedAdmins(db);
    const [admin] = await db.select().from(editors).limit(1);
    const result = small([oneTime("500"), oneTime("501")]);
    await writeImport(db, result);
    await db.update(events).set({ reviewStatus: "rejected" }).where(eq(events.sourceId, "500"));
    await db
      .update(events)
      .set({ deletedAt: new Date(), deletedBy: admin.id })
      .where(eq(events.sourceId, "501"));
    const changed = structuredClone(result);
    changed.events.forEach((e) => (e.title = `${e.title} (changed)`));
    const report = await writeImport(db, changed);
    expect(report.updated).toHaveLength(2);
    expect((await eventBySource(db, "500")).reviewStatus).toBe("rejected");
    expect((await eventBySource(db, "501")).deletedAt).not.toBeNull();
  });

  it("an Event that the feed no longer has is reported and not deleted", async () => {
    await writeImport(db, small([oneTime("600"), oneTime("601")]));
    const report = await writeImport(db, small([oneTime("600")]));
    expect(report.notInFeed).toEqual([{ sourceId: "601", title: "Event 601" }]);
    expect((await counts(db)).events).toBe(2);
  });

  it("an Event that fails a database check rolls back alone; the other Events are written", async () => {
    const bad = oneTime("701", {
      tagSlugs: ["race"],
      rule: {
        ...oneTime("701").rule,
        timing: { kind: "timed", start: "2026-10-20T20:00", end: "2026-10-20T18:00" },
      },
    });
    const report = await writeImport(
      db,
      small([oneTime("700"), bad, oneTime("702")], [{ calendar: "rides", name: "Race", slug: "race" }]),
    );
    expect(report.failed.map((f) => f.sourceId)).toEqual(["701"]);
    expect(report.failed[0].message).toMatch(/events_timing_shape|check/i);
    expect(report.inserted.map((e) => e.sourceId)).toEqual(["700", "702"]);
    expect(await counts(db)).toMatchObject({ events: 2, tags: 0, history: 2 });
  });

  it("an Event that moves to the other Calendar gets the Tags of the new Calendar", async () => {
    const tagList: ImportResult["tags"] = [
      { calendar: "rides", name: "Community", slug: "community" },
      { calendar: "advocacy", name: "Meeting", slug: "meeting" },
    ];
    await writeImport(db, small([oneTime("800", { tagSlugs: ["community"] })], tagList));
    const moved = small([oneTime("800", { calendar: "advocacy", tagSlugs: ["meeting"] })], tagList);
    const report = await writeImport(db, moved);
    expect(report.failed).toEqual([]);
    const row = await eventBySource(db, "800");
    expect(row.calendar).toBe("advocacy");
    expect(await tagSlugsOf(db, row.id)).toEqual([{ slug: "meeting", calendar: "advocacy" }]);
  });

  describe("image_url is never downgraded", () => {
    const blobUrl = "https://store.public.blob.vercel-storage.com/events/abc.jpg";
    const tockifyUrl = "https://d3fd4e4oyqldw5.cloudfront.net/a.jpg";

    it("a run without Blob credentials keeps the Blob URL from an earlier run", async () => {
      await writeImport(db, small([oneTime("900", { imageUrl: blobUrl })]));
      const report = await writeImport(db, small([oneTime("900", { imageUrl: tockifyUrl })]), {
        uncopiedImages: new Set(["900"]),
      });
      expect(report.unchanged.map((e) => e.sourceId)).toEqual(["900"]);
      expect((await eventBySource(db, "900")).imageUrl).toBe(blobUrl);
    });

    it("a failed download keeps the existing Blob URL", async () => {
      await writeImport(db, small([oneTime("901", { imageUrl: blobUrl })]));
      const report = await writeImport(
        db,
        small([oneTime("901", { imageUrl: tockifyUrl, title: "New title" })]),
        { uncopiedImages: new Set(["901"]) },
      );
      expect(report.updated.map((e) => e.sourceId)).toEqual(["901"]);
      const row = await eventBySource(db, "901");
      expect(row.title).toBe("New title");
      expect(row.imageUrl).toBe(blobUrl);
    });

    it("Stored null, feed adds an image, copy fails → Tockify URL is written", async () => {
      await writeImport(db, small([oneTime("903", { imageUrl: null })]));
      const report = await writeImport(db, small([oneTime("903", { imageUrl: tockifyUrl })]), {
        uncopiedImages: new Set(["903"]),
      });
      expect(report.updated.map((e) => e.sourceId)).toEqual(["903"]);
      expect((await eventBySource(db, "903")).imageUrl).toBe(tockifyUrl);
    });

    it("stored Tockify URL, feed has another one, copy fails → the new Tockify URL is written", async () => {
      const other = "https://d3fd4e4oyqldw5.cloudfront.net/b.jpg";
      await writeImport(db, small([oneTime("904", { imageUrl: tockifyUrl })]), {
        uncopiedImages: new Set(["904"]),
      });
      await writeImport(db, small([oneTime("904", { imageUrl: other })]), {
        uncopiedImages: new Set(["904"]),
      });
      expect((await eventBySource(db, "904")).imageUrl).toBe(other);
    });

    it("a new Event with no copy gets the Tockify URL", async () => {
      await writeImport(db, small([oneTime("902", { imageUrl: tockifyUrl })]), {
        uncopiedImages: new Set(["902"]),
      });
      expect((await eventBySource(db, "902")).imageUrl).toBe(tockifyUrl);
    });
  });
});
