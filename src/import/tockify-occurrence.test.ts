import { describe, expect, it } from "vitest";
import { parseIcsEvents } from "./ics";
import { toTockifyOccurrence } from "./tockify-occurrence";

/** A Tockify VEVENT with the fields of the real feed. `lines` replace or add properties. */
function vevent(lines: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    UID: "UID:TKF/68fe9822e5114f6b1b636a97/1/29815185/0/0",
    DTSTART: "DTSTART:20260909T234500Z",
    DTEND: "DTEND:20260910T030000Z",
    URL: "URL:https://tockify.com/bikegr/detail/1/1788911100000",
    SUMMARY: "SUMMARY: Wednesday Evening Rides",
    DESCRIPTION: "DESCRIPTION:\\nWeekly ride\\, all paces.\\n",
    CATEGORIES: "CATEGORIES:Group-Ride,Wednesday,Non-Drop",
    LOCATION: "LOCATION:Riverside Park Boat Launch Lot\\,Riverside Park Dr NW\\, Grand Rapids",
    "X-TKF-FEATURED-IMAGE": "X-TKF-FEATURED-IMAGE:https://d3flpus5evl89n.cloudfront.net/a/b.png",
    "X-TKF-CUSTOM-PREVIEW": "X-TKF-CUSTOM-PREVIEW: Weekly ride, all…",
    "X-TKF-PROMOTION-BUTTON":
      "X-TKF-PROMOTION-BUTTON;label=Ride Details;skip_details=false:https://example.org/ride",
    ...lines,
  };
  const body = Object.values(base).filter((line): line is string => line !== null);
  const [event] = parseIcsEvents(["BEGIN:VEVENT", ...body, "END:VEVENT"].join("\r\n"));
  return toTockifyOccurrence(event);
}

describe("Tockify Occurrence mapping", () => {
  it("reads Source ID and start minutes from the UID", () => {
    expect(vevent()).toMatchObject({ tockifyEventId: "1", startMinutes: 29815185 });
  });

  it("rejects a UID that is not a Tockify UID", () => {
    expect(() => vevent({ UID: "UID:abc@example.org" })).toThrow(/UID/);
  });

  it("converts UTC to Detroit wall-clock in summer (EDT)", () => {
    expect(vevent().timing).toEqual({
      kind: "timed",
      start: "2026-09-09T19:45",
      end: "2026-09-09T23:00",
    });
  });

  it("converts UTC to Detroit wall-clock in winter (EST)", () => {
    const occurrence = vevent({
      DTSTART: "DTSTART:20261209T004500Z",
      DTEND: "DTEND:20261209T040000Z",
    });
    expect(occurrence.timing).toEqual({
      kind: "timed",
      start: "2026-12-08T19:45",
      end: "2026-12-08T23:00",
    });
  });

  it("maps VALUE=DATE to an all-day Timing with an inclusive end date", () => {
    const occurrence = vevent({
      DTSTART: "DTSTART;VALUE=DATE:20260901",
      DTEND: "DTEND;VALUE=DATE:20261001",
    });
    expect(occurrence.timing).toEqual({
      kind: "allDay",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
  });

  it("maps a one-day all-day Event to the same start and end date", () => {
    const occurrence = vevent({
      DTSTART: "DTSTART;VALUE=DATE:20260912",
      DTEND: "DTEND;VALUE=DATE:20260913",
    });
    expect(occurrence.timing).toEqual({
      kind: "allDay",
      startDate: "2026-09-12",
      endDate: "2026-09-12",
    });
  });

  it("uses the start as the end when DTEND is missing", () => {
    const occurrence = vevent({ DTEND: null });
    expect(occurrence.timing).toEqual({
      kind: "timed",
      start: "2026-09-09T19:45",
      end: "2026-09-09T19:45",
    });
  });

  it("cancelled prefix gives cancelled and is removed from the title", () => {
    const occurrence = vevent({ SUMMARY: "SUMMARY:**Cancelled** Wednesday Evening Rides" });
    expect(occurrence.scheduleStatus).toBe("cancelled");
    expect(occurrence.title).toBe("Wednesday Evening Rides");
  });

  it("STATUS:CANCELLED without a prefix gives cancelled", () => {
    expect(vevent({ STATUS: "STATUS:CANCELLED" }).scheduleStatus).toBe("cancelled");
  });

  it("provisional prefix gives tentative and is removed from the title", () => {
    const occurrence = vevent({
      SUMMARY: "SUMMARY:**Provisional (date to be confirmed)** Hair of the Dog Ride",
    });
    expect(occurrence.scheduleStatus).toBe("tentative");
    expect(occurrence.title).toBe("Hair of the Dog Ride");
  });

  it.each([
    ["**CANCELLED** Dawn Patrol", "cancelled"],
    ["**Canceled** Dawn Patrol", "cancelled"],
    ["**cancelled**Dawn Patrol", "cancelled"],
    ["**PROVISIONAL (date to be confirmed)** Dawn Patrol", "tentative"],
  ])("prefix %s is matched without regard to case", (summary, status) => {
    const occurrence = vevent({ SUMMARY: `SUMMARY:${summary}` });
    expect(occurrence.scheduleStatus).toBe(status);
    expect(occurrence.title).toBe("Dawn Patrol");
    expect(occurrence.unknownTitlePrefix).toBeNull();
  });

  it("an unknown prefix stays in the title and is reported", () => {
    const occurrence = vevent({ SUMMARY: "SUMMARY:**Sold out** PEDALS 2026" });
    expect(occurrence.scheduleStatus).toBe("scheduled");
    expect(occurrence.title).toBe("**Sold out** PEDALS 2026");
    expect(occurrence.unknownTitlePrefix).toBe("**Sold out**");
  });

  it("a title with no prefix reports no unknown prefix", () => {
    expect(vevent().unknownTitlePrefix).toBeNull();
  });

  it("leading space in SUMMARY is removed", () => {
    expect(vevent().title).toBe("Wednesday Evening Rides");
  });

  it("unescapes and trims the description and location", () => {
    const occurrence = vevent();
    expect(occurrence.description).toBe("Weekly ride, all paces.");
    expect(occurrence.location).toBe("Riverside Park Boat Launch Lot,Riverside Park Dr NW, Grand Rapids");
  });

  it("a missing location gives null", () => {
    expect(vevent({ LOCATION: null }).location).toBeNull();
  });

  it("reads the categories and drops empty ones", () => {
    expect(vevent().categories).toEqual(["Group-Ride", "Wednesday", "Non-Drop"]);
    expect(vevent({ CATEGORIES: "CATEGORIES:" }).categories).toEqual([]);
    expect(vevent({ CATEGORIES: "CATEGORIES:A\\\\,B" }).categories).toEqual(["A\\", "B"]);
  });

  it("promotion button gives a CTA label and URL", () => {
    expect(vevent().cta).toEqual({ label: "Ride Details", url: "https://example.org/ride" });
    expect(vevent({ "X-TKF-PROMOTION-BUTTON": null }).cta).toBeNull();
  });

  it("featured image URL is kept; URL and X-TKF-CUSTOM-PREVIEW are dropped", () => {
    const occurrence = vevent();
    expect(occurrence.imageUrl).toBe("https://d3flpus5evl89n.cloudfront.net/a/b.png");
    expect(JSON.stringify(occurrence)).not.toContain("tockify.com/bikegr/detail");
    expect(JSON.stringify(occurrence)).not.toContain("all…");
    expect(vevent({ "X-TKF-FEATURED-IMAGE": null }).imageUrl).toBeNull();
  });
});
