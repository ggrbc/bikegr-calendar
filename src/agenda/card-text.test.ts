import { describe, expect, it } from "vitest";
import { cardDate, cardTime, dateLine, eventsFromHeading, normalizeLocation, tagLine, venueName } from "./card-text";
import { allDay, timed } from "./test-fixtures";

describe("card text (Tockify style)", () => {
  it("dates have the short weekday, the short month, and an ordinal day", () => {
    expect(cardDate("2026-10-10")).toBe("Sat Oct 10th");
    expect(cardDate("2026-10-01")).toBe("Thu Oct 1st");
    expect(cardDate("2026-10-02")).toBe("Fri Oct 2nd");
    expect(cardDate("2026-10-03")).toBe("Sat Oct 3rd");
    expect(cardDate("2026-10-11")).toBe("Sun Oct 11th");
    expect(cardDate("2026-10-12")).toBe("Mon Oct 12th");
    expect(cardDate("2026-10-13")).toBe("Tue Oct 13th");
    expect(cardDate("2026-10-21")).toBe("Wed Oct 21st");
    expect(cardDate("2026-10-22")).toBe("Thu Oct 22nd");
    expect(cardDate("2026-10-23")).toBe("Fri Oct 23rd");
  });

  it("times are lowercase with no space: 8:00am, 12:00pm, 12:30am", () => {
    expect(cardTime("2026-10-10T08:00")).toBe("8:00am");
    expect(cardTime("2026-10-10T12:00")).toBe("12:00pm");
    expect(cardTime("2026-10-10T00:30")).toBe("12:30am");
  });

  it("date line: start only, a range on one day, a range over days, all-day", () => {
    expect(dateLine(timed("2026-10-10", "08:00", "08:00"))).toBe("Sat Oct 10th 8:00am");
    expect(dateLine(timed("2026-10-12", "18:20", "21:00"))).toBe("Mon Oct 12th 6:20pm - 9:00pm");
    expect(dateLine({ kind: "timed", start: "2026-10-17T18:00", end: "2026-10-18T02:00" })).toBe(
      "Sat Oct 17th 6:00pm - Sun Oct 18th 2:00am",
    );
    expect(dateLine(allDay("2026-10-17"))).toBe("Sat Oct 17th");
    expect(dateLine(allDay("2026-10-17", "2026-10-18"))).toBe("Sat Oct 17th - Sun Oct 18th");
  });

  it("the list heading names the first day", () => {
    expect(eventsFromHeading("2026-10-10")).toBe("Events from Oct 10th");
  });

  it("venue is the text before the first comma; the full location gets one space after each comma", () => {
    const location = "Riverside Park North Trailhead,White Pine Trail, Grand Rapids ,MI";
    expect(venueName(location)).toBe("Riverside Park North Trailhead");
    expect(normalizeLocation(location)).toBe("Riverside Park North Trailhead, White Pine Trail, Grand Rapids, MI");
    expect(venueName("  Ada Park  ")).toBe("Ada Park");
  });

  it("Tags are joined with a bullet", () => {
    expect(
      tagLine([
        { name: "Group Ride", slug: "group-ride" },
        { name: "Non-Drop", slug: "non-drop" },
      ]),
    ).toBe("Group Ride • Non-Drop");
  });
});
