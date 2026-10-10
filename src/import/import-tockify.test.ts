import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, expandOccurrences } from "@/engine";
import { parseIcsEvents } from "./ics";
import { importTockify } from "./import-tockify";
import { toTockifyOccurrence } from "./tockify-occurrence";

/** The real Tockify feed, downloaded 2026-10-09. */
const feed = new Uint8Array(
  readFileSync(new URL("./__fixtures__/tockify-bikegr-2026-10-09.ics", import.meta.url)),
);
const result = importTockify(feed);
const feedOccurrences = parseIcsEvents(feed).map(toTockifyOccurrence);

describe("Tockify import — real feed fixture", () => {
  it("fixture has 551 Occurrences, 28 Events, and 15 Series", () => {
    expect(feedOccurrences).toHaveLength(551);
    expect(new Set(feedOccurrences.map((o) => o.tockifyEventId)).size).toBe(28);
    expect(result.series).toHaveLength(15);
  });

  it("feed horizon is 2029-07-04", () => {
    expect(result.feedHorizon).toBe("2029-07-04");
  });

  it("every Series is rebuilt by an exact-match rule or flagged, and the report matches the expected table", () => {
    const table = Object.fromEntries(
      result.series.map((s) => [
        `${s.sourceId} ${s.title}`,
        `${s.outcome} | ${s.rrule} | until ${s.until ?? "open-ended"} | ` +
          `${s.occurrences} Occurrences, ${s.exdates} EXDATEs, ${s.overrides} Overrides`,
      ]),
    );
    expect(table).toEqual({
      "1 Wednesday Evening Rides":
        "rule | FREQ=WEEKLY;BYDAY=WE;UNTIL=20281004T235959 | until 2028-10-04 | 109 Occurrences, 0 EXDATEs, 1 Overrides",
      "2 Switchback Community Ride":
        "rule | FREQ=WEEKLY;BYDAY=TH;UNTIL=20281005T235959 | until 2028-10-05 | 109 Occurrences, 0 EXDATEs, 0 Overrides",
      "3 Kent County Road Commission Meeting":
        "rule | FREQ=MONTHLY;BYDAY=2TU,4TU | until open-ended | 67 Occurrences, 0 EXDATEs, 0 Overrides",
      "7 ENTF Transportation Subcommittee":
        "rule | FREQ=MONTHLY;BYDAY=2TU | until open-ended | 33 Occurrences, 0 EXDATEs, 0 Overrides",
      "8 Mobile GR Commission Meeting":
        "rule | FREQ=MONTHLY;BYDAY=2WE | until open-ended | 34 Occurrences, 0 EXDATEs, 0 Overrides",
      "9 Hair of the Dog Ride":
        "rule | FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1 | until open-ended | 3 Occurrences, 0 EXDATEs, 3 Overrides",
      "12 ENTF Transportation Committee Meeting":
        "rule | FREQ=MONTHLY;BYDAY=4TU | until open-ended | 34 Occurrences, 0 EXDATEs, 0 Overrides",
      "40 Luton Loops & Libations":
        "rule | FREQ=WEEKLY;BYDAY=WE;UNTIL=20260930T235959 | until 2026-09-30 | 4 Occurrences, 0 EXDATEs, 0 Overrides",
      "52 VBF Tuesday Night Road Ride":
        "rule | FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959 | until 2026-10-27 | 8 Occurrences, 0 EXDATEs, 0 Overrides",
      "55 Kentwood Challenger":
        "rule | FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028T235959 | until 2026-10-28 | 8 Occurrences, 0 EXDATEs, 0 Overrides",
      "56 Dawn Patrol":
        "rule | FREQ=WEEKLY;BYDAY=SA;UNTIL=20261031T235959 | until 2026-10-31 | 8 Occurrences, 0 EXDATEs, 0 Overrides",
      "57 Gravel Grinders":
        "rule | FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026T235959 | until 2026-10-26 | 7 Occurrences, 0 EXDATEs, 0 Overrides",
      "58 Grand Rapids Bike Polo":
        "rule | FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;UNTIL=20260924T235959 | until 2026-09-24 | 2 Occurrences, 0 EXDATEs, 0 Overrides",
      "59 11th Annual CDR":
        "rule | FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=4 | until open-ended | 3 Occurrences, 0 EXDATEs, 0 Overrides",
      "61 Ada Park Thursday Group Ride":
        "rule | FREQ=WEEKLY;BYDAY=TH;UNTIL=20281005T235959 | until 2028-10-05 | 109 Occurrences, 0 EXDATEs, 0 Overrides",
    });
    expect(result.flags).toEqual([]);
  });

  it("every rebuilt Series, with its Overrides, expands through the engine to exactly its feed Occurrences", () => {
    const window = { from: "2026-01-01", to: addDays(result.feedHorizon, 1) };
    for (const report of result.series.filter((s) => s.outcome === "rule")) {
      const event = result.events.find((e) => e.sourceId === report.sourceId)!;
      const expanded = expandOccurrences(event.rule, result.overrides, window).map((o) => ({
        timing: o.timing,
        scheduleStatus: o.scheduleStatus,
        title: o.title ?? event.title,
        location: o.location ?? event.location,
      }));
      const expected = feedOccurrences
        .filter((o) => o.tockifyEventId === report.sourceId)
        .sort((a, b) => a.startMinutes - b.startMinutes)
        .map((o) => ({
          timing: o.timing,
          scheduleStatus: o.scheduleStatus,
          title: o.title,
          location: o.location,
        }));
      expect(expanded, report.title).toEqual(expected);
    }
  });

  it("Wednesday Evening Rides on 2026-09-30 is a cancelled Override", () => {
    expect(result.overrides.filter((o) => o.eventId === "1")).toEqual([
      { eventId: "1", originalStart: "2026-09-30T19:45", scheduleStatus: "cancelled" },
    ]);
  });

  it("Hair of the Dog Ride is yearly with three tentative Overrides", () => {
    expect(result.overrides.filter((o) => o.eventId === "9")).toEqual([
      { eventId: "9", originalStart: "2027-01-01T10:00", scheduleStatus: "tentative" },
      { eventId: "9", originalStart: "2028-01-01T10:00", scheduleStatus: "tentative" },
      { eventId: "9", originalStart: "2029-01-01T10:00", scheduleStatus: "tentative" },
    ]);
  });

  it("all-day Events keep their inclusive dates", () => {
    const millionMile = result.events.find((e) => e.sourceId === "39")!;
    expect(millionMile.rule.timing).toEqual({
      kind: "allDay",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
  });

  it("seven Events go to advocacy, and the rest to rides", () => {
    const advocacy = result.events.filter((e) => e.calendar === "advocacy").map((e) => e.sourceId);
    expect(advocacy.sort()).toEqual(["12", "28", "29", "3", "62", "7", "8"]);
    expect(result.events.filter((e) => e.calendar === "rides")).toHaveLength(21);
  });

  it("no title contains **; no Tag is a weekday or Advocacy", () => {
    expect(result.events.filter((e) => e.title.includes("**"))).toEqual([]);
    const names = result.tags.map((t) => t.name.toLowerCase());
    for (const banned of ["advocacy", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday"]) {
      expect(names).not.toContain(banned);
    }
  });

  it("Tags are listed once per Calendar, and every Event Tag is in the list", () => {
    const keys = result.tags.map((t) => `${t.calendar}/${t.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const event of result.events) {
      for (const slug of event.tagSlugs) expect(keys).toContain(`${event.calendar}/${slug}`);
    }
    expect(result.tags.filter((t) => t.calendar === "advocacy")).toEqual([]);
  });

  it("keeps CTAs and image URLs and drops Tockify's own detail URLs", () => {
    const wednesday = result.events.find((e) => e.sourceId === "1")!;
    expect(wednesday.cta?.url).toMatch(/^https?:\/\//);
    expect(wednesday.imageUrl).toMatch(/cloudfront\.net/);
    expect(JSON.stringify(result)).not.toContain("tockify.com/bikegr/detail");
  });

  it("the feed with its VEVENTs in reverse order gives the same result", () => {
    // latin1 keeps one character per byte, so the UTF-8 bytes go back unchanged.
    const text = Buffer.from(feed).toString("latin1");
    const blocks = text.match(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT\r\n/g)!;
    expect(blocks).toHaveLength(551);
    const head = text.slice(0, text.indexOf(blocks[0]));
    const tail = text.slice(text.lastIndexOf(blocks[blocks.length - 1]) + blocks.at(-1)!.length);
    const reversed = new Uint8Array(
      Buffer.from(head + [...blocks].reverse().join("") + tail, "latin1"),
    );
    expect(reversed).not.toEqual(feed);
    expect(importTockify(reversed)).toEqual(result);
  });
});
