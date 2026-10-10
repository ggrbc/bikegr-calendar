import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { parseFilters } from "@/agenda/filters";
import type { CalendarSnapshot } from "@/agenda/snapshot";
import { allDay, row, snapshotEvent, timed } from "@/agenda/test-fixtures";
import type { ScheduleStatus } from "@/engine";
import { buildFeed, feedPath, feedTitle, feedWindow, parseFeedName, webcalUrl } from "./feed";
import { buildCalendarFile, occurrenceToVevent } from "./vevent";

const NOW = new Date("2026-10-12T15:00:00.000Z");
const TODAY = "2026-10-12";
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function parseCalendar(text: string) {
  return new ICAL.Component(ICAL.parse(text));
}

function vevents(text: string) {
  return parseCalendar(text).getAllSubcomponents("vevent");
}

const one = (r = row()) => vevents(buildCalendarFile({ name: "Test", rows: [r], now: NOW }))[0];

const prop = (event: ICAL.Component, name: string) => event.getFirstPropertyValue(name);

describe("VEVENT", () => {
  it("UID is <eventId>-<originalStart>@calendar.bikegr.org and is the same on two runs", () => {
    const first = buildCalendarFile({ name: "Test", rows: [row()], now: NOW });
    const second = buildCalendarFile({ name: "Test", rows: [row()], now: new Date("2026-10-13T00:00:00Z") });
    expect(prop(vevents(first)[0], "uid")).toBe(`${ID}-2026-10-14T18:00@calendar.bikegr.org`);
    expect(prop(vevents(second)[0], "uid")).toBe(prop(vevents(first)[0], "uid"));
  });

  it("rescheduled Occurrence keeps its UID, has the new time, and 'Rescheduled from' in the description", () => {
    const event = one(
      row({
        originalTiming: timed("2026-10-13"),
        timing: timed("2026-10-15", "18:30", "20:30"),
        scheduleStatus: "rescheduled",
      }),
    );
    expect(prop(event, "uid")).toBe(`${ID}-2026-10-13T18:00@calendar.bikegr.org`);
    expect(String(prop(event, "dtstart"))).toBe("2026-10-15T22:30:00Z");
    expect(String(prop(event, "description"))).toMatch(/^Rescheduled from Tue, Oct 13, 6:00 pm/);
    expect(prop(event, "summary")).toBe("Tuesday Night Ride");
  });

  it("each Schedule status gives its STATUS; postponed gives CANCELLED", () => {
    const expected: Record<ScheduleStatus, string> = {
      scheduled: "CONFIRMED",
      tentative: "TENTATIVE",
      cancelled: "CANCELLED",
      postponed: "CANCELLED",
      rescheduled: "CONFIRMED",
    };
    for (const [status, ics] of Object.entries(expected)) {
      expect(prop(one(row({ scheduleStatus: status as ScheduleStatus })), "status"), status).toBe(ics);
    }
  });

  it("cancelled, postponed, and tentative titles get their prefix; scheduled and rescheduled do not", () => {
    const summary = (scheduleStatus: ScheduleStatus) => prop(one(row({ scheduleStatus })), "summary");
    expect(summary("cancelled")).toBe("[Cancelled] Tuesday Night Ride");
    expect(summary("postponed")).toBe("[Postponed] Tuesday Night Ride");
    expect(summary("tentative")).toBe("[Date to be confirmed] Tuesday Night Ride");
    expect(summary("scheduled")).toBe("Tuesday Night Ride");
    expect(summary("rescheduled")).toBe("Tuesday Night Ride");
  });

  it("Schedule note and CTA URL are in the description", () => {
    const event = one(
      row({
        scheduleStatus: "cancelled",
        scheduleNote: "Rain — see you next week",
        description: "Bring lights.",
        cta: { label: "Register", url: "https://example.org/register" },
      }),
    );
    expect(prop(event, "description")).toBe(
      [
        "Cancelled — Rain — see you next week",
        "Bring lights.",
        "Register: https://example.org/register",
        `https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`,
      ].join("\n\n"),
    );
    expect(prop(event, "url")).toBe(`https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`);
  });

  it("timed Occurrence has UTC DTSTART and DTEND, also across the DST change days", () => {
    const summer = one(row({ timing: timed("2026-10-14", "18:00", "21:00") }));
    expect(String(prop(summer, "dtstart"))).toBe("2026-10-14T22:00:00Z");
    expect(String(prop(summer, "dtend"))).toBe("2026-10-15T01:00:00Z");
    // 2026-11-01: 01:30 occurs twice (first = EDT); 2027-03-14: 02:30 does not exist (03:30 EDT).
    const fallBack = one(row({ timing: timed("2026-11-01", "01:30", "02:30") }));
    expect(String(prop(fallBack, "dtstart"))).toBe("2026-11-01T05:30:00Z");
    expect(String(prop(fallBack, "dtend"))).toBe("2026-11-01T07:30:00Z");
    const spring = one(row({ timing: timed("2027-03-14", "02:30", "04:00") }));
    expect(String(prop(spring, "dtstart"))).toBe("2027-03-14T07:30:00Z");
    expect(String(prop(spring, "dtend"))).toBe("2027-03-14T08:00:00Z");
  });

  it("all-day Occurrence has VALUE=DATE and an exclusive DTEND", () => {
    const event = one(row({ timing: allDay("2026-10-17", "2026-10-18") }));
    const start = event.getFirstProperty("dtstart")!;
    expect(start.type).toBe("date");
    expect(String(start.getFirstValue())).toBe("2026-10-17");
    expect(String(prop(event, "dtend"))).toBe("2026-10-19");
  });

  it("zero-length Occurrence has no DTEND", () => {
    const event = one(row({ timing: timed("2026-10-14", "07:00", "07:00") }));
    expect(event.hasProperty("dtend")).toBe(false);
  });

  it("description with commas, semicolons, new lines, and emoji survives a parse with ical.js", () => {
    const description = "Helmets required; lights, too.\nBack slash \\ and 🚲 emoji, ñ é. ".repeat(4).trim();
    const event = one(
      row({ description, location: "Riverside Park, Grand Rapids; MI", tags: [{ name: "Non-Drop, Social", slug: "x" }] }),
    );
    expect(String(prop(event, "description"))).toContain(description);
    expect(prop(event, "location")).toBe("Riverside Park, Grand Rapids; MI");
    expect(event.getFirstProperty("categories")!.getValues()).toEqual(["Non-Drop, Social"]);
  });

  it("has DTSTAMP and LAST-MODIFIED", () => {
    const lines = occurrenceToVevent(row({ lastModified: "2026-10-05T08:09:10.000Z" }), NOW);
    expect(lines).toContain("DTSTAMP:20261012T150000Z");
    expect(lines).toContain("LAST-MODIFIED:20261005T080910Z");
  });
});

describe("Feed", () => {
  const snapshot: CalendarSnapshot = {
    events: [
      snapshotEvent({
        title: "Tuesday Night Ride",
        timing: timed("2026-10-13"),
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        tags: [{ name: "Non-Drop", slug: "non-drop" }],
      }),
      snapshotEvent({
        id: "11111111-2222-4333-8444-555555555555",
        title: "Thursday Ride",
        timing: timed("2026-10-15"),
        rrule: "FREQ=WEEKLY;BYDAY=TH",
      }),
    ],
    tags: [{ calendar: "rides", name: "Non-Drop", slug: "non-drop" }],
  };
  const feed = (query: string) =>
    buildFeed({ snapshot, calendar: "rides", filters: parseFilters(new URLSearchParams(query), TODAY), today: TODAY, now: NOW });

  it("parses with ical.js, and each Occurrence is one VEVENT", () => {
    const calendar = parseCalendar(feed(""));
    expect(calendar.getFirstPropertyValue("x-wr-calname")).toBe("Bike GR — Rides & Events");
    expect(calendar.getFirstPropertyValue("x-wr-timezone")).toBe("America/Detroit");
    expect(calendar.getFirstPropertyValue("method")).toBe("PUBLISH");
    const uids = calendar.getAllSubcomponents("vevent").map((e) => e.getFirstPropertyValue("uid"));
    expect(new Set(uids).size).toBe(uids.length);
    // Both weekly Series, from 2026-10-13 (the first date) to the end of the window.
    expect(uids.length).toBeGreaterThan(100);
  });

  it("window is 30 days back to 365 days forward", () => {
    expect(feedWindow(TODAY)).toEqual({ from: "2026-09-12", to: "2027-10-12" });
    const starts = vevents(feed("")).map((e) => String(e.getFirstPropertyValue("dtstart")));
    expect(starts.every((s) => s >= "2026-10-13" && s < "2027-10-13")).toBe(true);
  });

  it("filter by Tag and by day gives only matching VEVENTs", () => {
    const tuesday = vevents(feed("tag=non-drop")).map((e) => e.getFirstPropertyValue("summary"));
    expect(new Set(tuesday)).toEqual(new Set(["Tuesday Night Ride"]));
    const thursday = vevents(feed("day=thu")).map((e) => e.getFirstPropertyValue("summary"));
    expect(new Set(thursday)).toEqual(new Set(["Thursday Ride"]));
  });

  it("a Feed with day=sat includes a Fri–Sun all-day Event", () => {
    const weekend: CalendarSnapshot = {
      events: [snapshotEvent({ title: "Weekend Tour", timing: allDay("2026-10-16", "2026-10-18") })],
      tags: [],
    };
    const text = buildFeed({
      snapshot: weekend,
      calendar: "rides",
      filters: parseFilters(new URLSearchParams("day=sat"), TODAY),
      today: TODAY,
      now: NOW,
    });
    expect(vevents(text).map((e) => e.getFirstPropertyValue("summary"))).toEqual(["Weekend Tour"]);
  });

  it("a retired Tag slug gives a valid, empty calendar", () => {
    const text = feed("tag=retired-tag");
    expect(vevents(text)).toHaveLength(0);
    expect(parseCalendar(text).getFirstPropertyValue("x-wr-calname")).toBe("Bike GR — Rides & Events (filtered)");
  });

  it("names, paths, and webcal links", () => {
    expect(parseFeedName("rides.ics")).toBe("rides");
    expect(parseFeedName("all.ics")).toBeNull();
    expect(parseFeedName("toString")).toBeUndefined();
    expect(parseFeedName("other.ics")).toBeUndefined();
    const filters = parseFilters(new URLSearchParams("day=tue&from=2026-11-01"), TODAY);
    expect(feedPath("rides", filters, TODAY)).toBe("/feeds/rides.ics?day=tue");
    expect(feedPath(null, parseFilters(new URLSearchParams(""), TODAY), TODAY)).toBe("/feeds/all.ics");
    expect(feedTitle("advocacy", filters)).toBe("Bike GR — Advocacy (filtered)");
    expect(webcalUrl("/feeds/rides.ics")).toBe("webcal://calendar.bikegr.org/feeds/rides.ics");
  });
});
