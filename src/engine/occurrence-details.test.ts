import { describe, expect, it } from "vitest";
import { overrideInputToRow, overrideRowToInput } from "@/db/mappers";
import { expandOccurrences } from "./expand-occurrences";
import { makeEvent, override, timed } from "./test-helpers";

const window = { from: "2026-10-01", to: "2026-11-01" };

describe("Occurrence details", () => {
  it("a Series date gets the details of its Override only", () => {
    const series = makeEvent(timed("2026-10-07T18:00", "2026-10-07T20:00"), { rrule: "FREQ=WEEKLY" });
    const dates = expandOccurrences(series, [override("2026-10-14T18:00", { occurrenceDetails: "Route: loop" })], window);
    const byStart = Object.fromEntries(dates.map((o) => [o.originalStart, o.occurrenceDetails]));
    expect(byStart["2026-10-14T18:00"]).toBe("Route: loop");
    expect(byStart["2026-10-07T18:00"]).toBeUndefined();
    expect(byStart["2026-10-21T18:00"]).toBeUndefined();
  });

  it("a one-time Event has its own details", () => {
    const one = makeEvent(timed("2026-10-07T18:00", "2026-10-07T20:00"), { occurrenceDetails: "Bring lights" });
    expect(expandOccurrences(one, [], window)[0].occurrenceDetails).toBe("Bring lights");
  });

  it("an Override keeps its details through the row mappers", () => {
    const input = override("2026-10-14T18:00", { occurrenceDetails: "Route: loop" });
    expect(overrideRowToInput(overrideInputToRow(input, "evt")).occurrenceDetails).toBe("Route: loop");
  });
});
