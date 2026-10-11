import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors, eventManagers, events, overrides } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import type { SplitDraft } from "./event-input";
import { addManager } from "./managers";
import { saveOverride } from "./overrides";
import { splitSeries } from "./split-series";
import { addEditor, contentDraft, draft, historyOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

const TODAY = "2026-10-01";

function splitDraft(splitDate: string, patch: Partial<SplitDraft> = {}): SplitDraft {
  return {
    ...contentDraft(),
    splitDate,
    mode: "change",
    time: { kind: "timed", startTime: "18:30", endTime: "20:30" },
    rule: { kind: "same" },
    ...patch,
  };
}

describe("a Series split and Event managers", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let oldId: string;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    const created = await createEvent(db, erin, draft());
    if (!created.ok) throw new Error(created.message);
    oldId = created.id;
    await db.update(events).set({ reviewStatus: "approved" }).where(eq(events.id, oldId));
    await addManager(db, erin, { eventId: oldId, email: "sam@example.org", name: "Sam Leader" });
  });
  afterEach(async () => close());

  it("copies the grants to the new Series, keeps them on the old one, and writes history", async () => {
    const result = await splitSeries(db, erin, { id: oldId, version: 1 }, splitDraft("2026-11-03"), { today: TODAY });
    if (!result.ok) throw new Error(result.message);
    expect(result.kind).toBe("split");
    const [sam] = await db.select().from(editors).where(eq(editors.email, "sam@example.org"));
    const grants = await db.select().from(eventManagers).where(eq(eventManagers.editorId, sam.id));
    expect(grants.map((g) => g.eventId).sort()).toEqual([oldId, result.id].sort());
    const last = (await historyOf(db, result.id)).at(-1);
    expect(last).toMatchObject({ action: "managers-copied", changedBy: erin.id });
    expect((last!.snapshot as { detail: { managers: string[] } }).detail.managers).toEqual(["Sam Leader"]);
  });

  it("writes no copy entry when the Event has no managers", async () => {
    await db.delete(eventManagers);
    const result = await splitSeries(db, erin, { id: oldId, version: 1 }, splitDraft("2026-11-03"), { today: TODAY });
    if (!result.ok) throw new Error(result.message);
    expect((await historyOf(db, result.id)).map((h) => h.action)).not.toContain("managers-copied");
  });

  it("an Override with only Occurrence details moves with the dates to the new Series", async () => {
    await saveOverride(db, erin, { id: oldId, version: 1 }, {
      originalStart: "2026-11-10T18:00",
      timing: { kind: "timed", start: "2026-11-10T18:00", end: "2026-11-10T20:00" },
      title: "Tuesday Ride",
      location: "Shop",
      scheduleStatus: "scheduled",
      scheduleNote: null,
      occurrenceDetails: "Route: loop",
    });
    const result = await splitSeries(db, erin, { id: oldId, version: 2 }, splitDraft("2026-11-03"), { today: TODAY });
    if (!result.ok) throw new Error(result.message);
    const moved = await db.select().from(overrides).where(eq(overrides.eventId, result.id));
    expect(moved).toMatchObject([{ occurrenceDetails: "Route: loop" }]);
  });
});
