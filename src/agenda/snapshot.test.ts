import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrides } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { expandSnapshot } from "./occurrence-rows";
import { loadSnapshot } from "./snapshot";
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
      imageUrl: "https://blob.example/events/a.jpg",
      tags: [{ name: "Social", slug: "social" }],
      overrides: [{ originalStart: "2026-10-21T18:00", scheduleStatus: "cancelled" }],
    });
    expect(Object.keys(weekly.overrideUpdatedAt)).toEqual(["2026-10-21T18:00"]);
  });

  it("lists each Calendar's active Tags, also Tags with no Events, and not retired Tags", async () => {
    expect((await loadSnapshot(db, "rides")).tags).toEqual([
      { calendar: "rides", name: "Social", slug: "social" },
      { calendar: "rides", name: "Unused", slug: "unused" },
    ]);
    expect((await loadSnapshot(db, null)).tags.map((t) => t.slug)).toEqual([
      "social",
      "unused",
      "meeting",
    ]);
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
