import { describe, expect, it } from "vitest";
import {
  isUuid,
  occurrencePath,
  occurrenceUrl,
  parseOccurrencePath,
  parseStartSegment,
  startSegment,
} from "./occurrence-url";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("detail URL", () => {
  it("timed original start becomes 2026-10-14T1800; all-day becomes 2026-10-14", () => {
    expect(startSegment("2026-10-14T18:00")).toBe("2026-10-14T1800");
    expect(startSegment("2026-10-14")).toBe("2026-10-14");
    expect(occurrencePath(ID, "2026-10-14T18:00")).toBe(`/events/${ID}/2026-10-14T1800`);
    expect(occurrenceUrl(ID, "2026-10-14")).toBe(`https://calendar.bikegr.org/events/${ID}/2026-10-14`);
  });

  it("parse of the URL segment gives back the original start; bad segments are refused", () => {
    expect(parseStartSegment("2026-10-14T1800")).toBe("2026-10-14T18:00");
    expect(parseStartSegment("2026-10-14")).toBe("2026-10-14");
    for (const bad of ["2026-10-14T18:00", "2026-02-30", "2026-10-14T2400", "2026-10-14T1860", "x", ""]) {
      expect(parseStartSegment(bad), bad).toBeNull();
    }
  });

  it("parses a detail path and its .ics path; other paths give null", () => {
    expect(parseOccurrencePath(`/events/${ID}/2026-10-14T1800`)).toEqual({
      eventId: ID,
      segment: "2026-10-14T1800",
      isIcs: false,
    });
    expect(parseOccurrencePath(`/events/${ID}/2026-10-14/event.ics`)).toEqual({
      eventId: ID,
      segment: "2026-10-14",
      isIcs: true,
    });
    expect(parseOccurrencePath("/events/%E0%A4%A/2026-10-14")).toEqual({
      eventId: "%E0%A4%A",
      segment: "2026-10-14",
      isIcs: false,
    });
    expect(parseOccurrencePath("/events")).toBeNull();
    expect(parseOccurrencePath(`/events/${ID}`)).toBeNull();
    expect(parseOccurrencePath(`/events/${ID}/2026-10-14/other`)).toBeNull();
  });

  it("knows a UUID", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid("spike")).toBe(false);
  });
});
