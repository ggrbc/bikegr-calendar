import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { allDay, row, timed } from "@/agenda/test-fixtures";
import { googleCalendarUrl, icsFileName, outlookUrl, singleOccurrenceIcs } from "./add-to-calendar";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const query = (url: string) => new URL(url).searchParams;

describe("Add to calendar", () => {
  const ride = row({
    timing: timed("2026-10-14", "18:00", "21:00"),
    location: "Riverside Park",
    description: "Bring lights.",
  });

  it("Google link has UTC dates, the title, the location, and the details", () => {
    const url = googleCalendarUrl(ride);
    expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
    const params = query(url);
    expect(params.get("action")).toBe("TEMPLATE");
    expect(params.get("dates")).toBe("20261014T220000Z/20261015T010000Z");
    expect(params.get("text")).toBe("Tuesday Night Ride");
    expect(params.get("location")).toBe("Riverside Park");
    expect(params.get("details")).toContain("Bring lights.");
    expect(params.get("details")).toContain(`/events/${ID}/2026-10-14T1800`);
    expect(params.get("ctz")).toBe("America/Detroit");
  });

  it("Google link for an all-day Occurrence uses dates with an exclusive end", () => {
    expect(query(googleCalendarUrl(row({ timing: allDay("2026-10-17", "2026-10-18") }))).get("dates")).toBe(
      "20261017/20261019",
    );
  });

  it("Outlook link has UTC start and end, or allday=true with dates", () => {
    const timedParams = query(outlookUrl(ride));
    expect(timedParams.get("startdt")).toBe("2026-10-14T22:00:00Z");
    expect(timedParams.get("enddt")).toBe("2026-10-15T01:00:00Z");
    expect(timedParams.get("allday")).toBe("false");
    expect(timedParams.get("subject")).toBe("Tuesday Night Ride");
    const dayParams = query(outlookUrl(row({ timing: allDay("2026-10-17") })));
    expect([dayParams.get("startdt"), dayParams.get("enddt"), dayParams.get("allday")]).toEqual([
      "2026-10-17",
      "2026-10-18",
      "true",
    ]);
  });

  it("single .ics has one VEVENT with the Feed UID and parses with ical.js", () => {
    const calendar = new ICAL.Component(ICAL.parse(singleOccurrenceIcs(ride, new Date())));
    const events = calendar.getAllSubcomponents("vevent");
    expect(events).toHaveLength(1);
    expect(events[0].getFirstPropertyValue("uid")).toBe(`${ID}-2026-10-14T18:00@calendar.bikegr.org`);
  });

  it("file name comes from the title", () => {
    expect(icsFileName("Café Ride: 25 mi!")).toBe("cafe-ride-25-mi.ics");
    expect(icsFileName("🚲")).toBe("event.ics");
  });
});
