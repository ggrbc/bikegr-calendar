import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrides } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { findOccurrence } from "./find-occurrence";
import { addEvent, allDay, timed } from "./test-fixtures";

describe("findOccurrence", () => {
  let db: Db;
  let close: () => Promise<void>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ids.weekly = (
      await addEvent(db, {
        title: "Wednesday Evening Rides",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        exdates: ["2026-10-28T18:00"],
      })
    ).id;
    await db.insert(overrides).values({
      eventId: ids.weekly,
      originalStart: "2026-10-21T18:00",
      allDay: false,
      startLocal: "2026-10-22T18:30",
      endLocal: "2026-10-22T20:30",
    });
    ids.allDay = (await addEvent(db, { title: "Hair of the Dog Ride", timing: allDay("2027-01-01") })).id;
    ids.deleted = (await addEvent(db, { title: "Deleted ride", calendar: "advocacy", deletedAt: new Date() })).id;
    ids.pending = (await addEvent(db, { title: "Pending ride", reviewStatus: "pending" })).id;
    ids.rejected = (await addEvent(db, { title: "Rejected ride", reviewStatus: "rejected" })).id;
  });
  afterAll(async () => close());

  it("approved Event with a valid original start is found", async () => {
    const result = await findOccurrence(db, ids.weekly, "2026-10-14T1800");
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.row).toMatchObject({ title: "Wednesday Evening Rides", timing: timed("2026-10-14") });
    }
  });

  it("rescheduled Occurrence is found by its original start and has its new timing", async () => {
    const result = await findOccurrence(db, ids.weekly, "2026-10-21T1800");
    expect(result.kind === "found" && result.row).toMatchObject({
      scheduleStatus: "rescheduled",
      timing: timed("2026-10-22", "18:30", "20:30"),
    });
    // The new date is not a detail URL of its own.
    expect((await findOccurrence(db, ids.weekly, "2026-10-22T1830")).kind).toBe("missing");
  });

  it("deleted Event gives gone, with its Calendar", async () => {
    expect(await findOccurrence(db, ids.deleted, "2026-10-14T1800")).toEqual({ kind: "gone", calendar: "advocacy" });
  });

  it("pending or rejected Event gives missing", async () => {
    expect((await findOccurrence(db, ids.pending, "2026-10-14T1800")).kind).toBe("missing");
    expect((await findOccurrence(db, ids.rejected, "2026-10-14T1800")).kind).toBe("missing");
  });

  it("unknown id, a non-UUID id, and a bad start segment give missing", async () => {
    expect((await findOccurrence(db, "00000000-0000-4000-8000-000000000000", "2026-10-14T1800")).kind).toBe("missing");
    expect((await findOccurrence(db, "spike", "2026-10-14T1800")).kind).toBe("missing");
    expect((await findOccurrence(db, ids.weekly, "2026-10-14T18:00")).kind).toBe("missing");
  });

  it("start that is not a date of the Series, or is an EXDATE, gives missing", async () => {
    expect((await findOccurrence(db, ids.weekly, "2026-10-15T1800")).kind).toBe("missing");
    expect((await findOccurrence(db, ids.weekly, "2026-10-14T1900")).kind).toBe("missing");
    expect((await findOccurrence(db, ids.weekly, "2026-10-28T1800")).kind).toBe("missing");
  });

  it("all-day Occurrence is found by its date", async () => {
    const result = await findOccurrence(db, ids.allDay, "2027-01-01");
    expect(result.kind === "found" && result.row.timing).toEqual(allDay("2027-01-01"));
  });
});
