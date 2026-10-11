import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { editOneTimeEvent } from "./edit-event";
import { parseEventInput, parseOverrideInput } from "./event-input";
import { saveOverride } from "./overrides";
import { addEditor, draft, eventRow, overridesOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

describe("Occurrence details written by an Editor", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
  });
  afterEach(async () => close());

  const overrideInput = (occurrenceDetails: string) => ({
    originalStart: "2026-10-20T18:00",
    start: "2026-10-20T18:00",
    end: "2026-10-20T20:00",
    title: "Tuesday Ride",
    location: "Shop",
    scheduleStatus: "scheduled",
    scheduleNote: "",
    occurrenceDetails,
  });

  it("the Override form parses and trims details, and refuses more than 2,000 characters", () => {
    expect(parseOverrideInput(overrideInput("  Route: loop\r\n\r\nOff-road.  "), false)).toMatchObject({
      ok: true,
      value: { occurrenceDetails: "Route: loop\n\nOff-road." },
    });
    expect(parseOverrideInput(overrideInput(""), false)).toMatchObject({
      ok: true,
      value: { occurrenceDetails: null },
    });
    expect(parseOverrideInput(overrideInput("x".repeat(2000)), false).ok).toBe(true);
    expect(parseOverrideInput(overrideInput("x".repeat(2001)), false)).toMatchObject({
      ok: false,
      errors: { occurrenceDetails: expect.stringContaining("2,000") },
    });
  });

  it("an Override stores details, and an Override with only details is kept", async () => {
    const created = await createEvent(db, erin, draft());
    if (!created.ok) throw new Error(created.message);
    const parsed = parseOverrideInput(overrideInput("Route: loop"), false);
    if (!parsed.ok) throw new Error("parse");
    expect((await saveOverride(db, erin, { id: created.id, version: 1 }, parsed.value)).ok).toBe(true);
    expect(await overridesOf(db, created.id)).toMatchObject([
      { originalStart: "2026-10-20T18:00", occurrenceDetails: "Route: loop", scheduleStatus: null },
    ]);
  });

  it("a one-time Event stores details on the Event row; a Series keeps none there", async () => {
    const one = parseEventInput(
      {
        calendar: "rides",
        title: "Social",
        description: "",
        allDay: false,
        start: "2026-10-20T18:00",
        end: "2026-10-20T20:00",
        rule: { mode: "none" },
        scheduleStatus: "scheduled",
        scheduleNote: "",
        occurrenceDetails: "Bring lights",
      },
      { isAdmin: false, storedImageUrl: null, isImageUrl: () => false },
    );
    if (!one.ok) throw new Error(JSON.stringify(one.errors));
    const created = await createEvent(db, erin, one.value);
    if (!created.ok) throw new Error(created.message);
    expect((await eventRow(db, created.id)).occurrenceDetails).toBe("Bring lights");

    const next = { ...one.value, rule: { ...one.value.rule, occurrenceDetails: "Other route" } };
    expect((await editOneTimeEvent(db, erin, { id: created.id, version: 1 }, next)).ok).toBe(true);
    expect((await eventRow(db, created.id)).occurrenceDetails).toBe("Other route");
  });
});
