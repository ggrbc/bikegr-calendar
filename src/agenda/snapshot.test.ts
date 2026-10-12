import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { events, overrides, tags } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { expandSnapshot } from "./occurrence-rows";
import { loadSnapshot, snapshotEvents } from "./snapshot";
import { addEvent, addTag, tagEvent, timed } from "./test-fixtures";

describe("loadSnapshot", () => {
  let db: Db;
  let close: () => Promise<void>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ids.weekly = (
      await addEvent(db, {
        title: "Wednesday Evening Rides",
        description: "Bring lights.",
        preview: "Short.",
        imageUrl: "https://blob.example/events/a.jpg",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
      })
    ).id;
    await db.insert(overrides).values({
      eventId: ids.weekly,
      originalStart: "2026-10-21T18:00",
      scheduleStatus: "cancelled",
    });
    ids.advocacy = (await addEvent(db, { title: "Mobile GR Commission", calendar: "advocacy" })).id;
    await addEvent(db, { title: "Pending ride", reviewStatus: "pending" });
    await addEvent(db, { title: "Deleted ride", deletedAt: new Date() });

    const social = await addTag(db, "rides", "Social", "social");
    const old = await addTag(db, "rides", "Old Tag", "old-tag", true);
    await addTag(db, "rides", "Unused", "unused");
    await addTag(db, "advocacy", "Meeting", "meeting");
    await tagEvent(db, ids.weekly, social.id, "rides");
    await tagEvent(db, ids.weekly, old.id, "rides");
  });
  afterAll(async () => close());

  it("has only approved, not-deleted Events of the Calendar, with Overrides and active Tags", async () => {
    const snapshot = await loadSnapshot(db, "rides");
    expect(snapshot.events.map((e) => e.title)).toEqual(["Wednesday Evening Rides"]);
    const [weekly] = snapshot.events;
    expect(weekly).toMatchObject({
      description: "Bring lights.",
      preview: "Short.",
      imageUrl: "https://blob.example/events/a.jpg",
      tags: [{ name: "Social", slug: "social" }],
      overrides: [{ originalStart: "2026-10-21T18:00", scheduleStatus: "cancelled" }],
    });
    expect(Object.keys(weekly.overrideUpdatedAt)).toEqual(["2026-10-21T18:00"]);
    const all = await loadSnapshot(db, null);
    expect(all.events.find((e) => e.title === "Mobile GR Commission")?.preview).toBeNull();
  });

  it("lists the active Tags of both Calendars, also Tags with no Events, and not retired Tags", async () => {
    const expected = [
      { calendar: "rides", name: "Social", slug: "social" },
      { calendar: "rides", name: "Unused", slug: "unused" },
      { calendar: "advocacy", name: "Meeting", slug: "meeting" },
    ];
    expect((await loadSnapshot(db, "rides")).tags).toEqual(expected);
    expect((await loadSnapshot(db, null)).tags).toEqual(expected);
  });

  it("a CTA whose URL is not http or https is left out; an https CTA stays", async () => {
    const row = (title: string, ctaUrl: string) => ({
      calendar: "rides" as const,
      title,
      reviewStatus: "approved" as const,
      allDay: false,
      startLocal: "2026-10-15T18:00",
      endLocal: "2026-10-15T20:00",
      ctaLabel: "Click",
      ctaUrl,
    });
    const rows = await db
      .insert(events)
      .values([row("Unsafe CTA", "data:text/html,<script>alert(1)</script>"), row("Safe CTA", "https://example.org")])
      .returning();
    const [unsafe, safe] = await snapshotEvents(db, rows);
    expect(unsafe.cta).toBeNull();
    expect(safe.cta).toEqual({ label: "Click", url: "https://example.org", skipDetails: false });
    await db.delete(events).where(inArray(events.id, rows.map((r) => r.id)));
  });

  it("an Event's Tag carries its description only when it has one", async () => {
    const row = await addEvent(db, { title: "Alley Cat Night" });
    const alleyCat = await addTag(db, "rides", "Alley Cat", "alley-cat");
    await db.update(tags).set({ description: "Part race, part scavenger hunt." }).where(eq(tags.id, alleyCat.id));
    const plain = await addTag(db, "rides", "Night", "night");
    await tagEvent(db, row.id, alleyCat.id, "rides");
    await tagEvent(db, row.id, plain.id, "rides");

    const [snapshot] = await snapshotEvents(db, [row]);
    expect(snapshot.tags).toEqual([
      { name: "Alley Cat", slug: "alley-cat", description: "Part race, part scavenger hunt." },
      { name: "Night", slug: "night" },
    ]);
    await db.delete(events).where(eq(events.id, row.id));
    await db.delete(tags).where(inArray(tags.id, [alleyCat.id, plain.id]));
  });

  it("is plain data that survives structured clone (Next.js cache serialization)", async () => {
    const snapshot = await loadSnapshot(db, null);
    expect(structuredClone(snapshot)).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rows carry the description, the image, and the latest update time", async () => {
    const rows = expandSnapshot(await loadSnapshot(db, "rides"), { from: "2026-10-12", to: "2026-10-26" });
    expect(rows.map((r) => r.originalStart)).toEqual(["2026-10-14T18:00", "2026-10-21T18:00"]);
    const [plain, cancelled] = rows;
    expect(plain).toMatchObject({ description: "Bring lights.", imageUrl: "https://blob.example/events/a.jpg" });
    expect(cancelled.lastModified >= plain.lastModified).toBe(true);
    expect(plain.timing).toEqual(timed("2026-10-14"));
  });
});
