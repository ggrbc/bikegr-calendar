import { describe, expect, it } from "vitest";
import { conflictMessage, formatInstantDetroit, historyActionLabel, longDate } from "./format";

describe("admin text formats", () => {
  it("an instant formats as Detroit wall-clock time in summer and in winter", () => {
    // 19:12 UTC is 3:12 pm EDT (UTC-4) in October and 2:12 pm EST (UTC-5) in January.
    expect(formatInstantDetroit(new Date("2026-10-10T19:12:00Z"))).toBe(
      "3:12 pm on Saturday, October 10, 2026",
    );
    expect(formatInstantDetroit(new Date("2027-01-15T19:12:00Z"))).toBe(
      "2:12 pm on Friday, January 15, 2027",
    );
  });

  it("the conflict message names the time in Detroit and says reload", () => {
    expect(conflictMessage(new Date("2026-10-10T19:12:00Z"))).toBe(
      "Another Editor changed this Event at 3:12 pm on Saturday, October 10, 2026 (Detroit time). Reload to see their change.",
    );
  });

  it("long dates", () => {
    expect(longDate("2028-10-27")).toBe("October 27, 2028");
  });

  it("history actions in plain words, with the date of one Occurrence", () => {
    expect(historyActionLabel("create", {})).toBe("Created");
    expect(historyActionLabel("import", {})).toBe("Import");
    expect(historyActionLabel("override", { originalStart: "2026-11-03T18:00" })).toBe(
      "Changed one date (Tue, Nov 3)",
    );
    expect(historyActionLabel("split", { splitDate: "2026-11-03" })).toBe(
      "Series split: dates from Tue, Nov 3 moved to a new Event",
    );
    expect(historyActionLabel("something-new", {})).toBe("something-new");
  });
});
