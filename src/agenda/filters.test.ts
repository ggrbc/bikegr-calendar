import { describe, expect, it } from "vitest";
import {
  type AgendaFilters,
  filterWindow,
  hasContentFilters,
  matchesContent,
  matchesFilters,
  parseFilters,
  serializeFilters,
  switcherFilters,
} from "./filters";
import { allDay, row, timed } from "./test-fixtures";

const TODAY = "2026-10-12"; // a Monday

const parse = (query: string) => parseFilters(new URLSearchParams(query), TODAY);

const tagged = (...slugs: string[]) => slugs.map((slug) => ({ name: slug.toUpperCase(), slug }));

describe("parseFilters", () => {
  it("reads a comma list and repeated keys for Tags and days", () => {
    expect(parse("tag=non-drop,group-ride&tag=race&day=thu,tue&day=sat")).toMatchObject({
      tags: ["group-ride", "non-drop", "race"],
      days: ["tue", "thu", "sat"],
    });
  });

  it("reads a plain object of search params, as Next.js pages give them", () => {
    const filters = parseFilters({ tag: ["a", "b"], day: "mon", q: undefined }, TODAY);
    expect(filters).toMatchObject({ tags: ["a", "b"], days: ["mon"], q: "" });
  });

  it("lowercases Tag slugs and keeps an unknown or badly formed slug", () => {
    expect(parse("tag=Non-Drop,%20Bad%20Slug!,,").tags).toEqual(["bad slug!", "non-drop"]);
  });

  it("drops unknown days, and all seven days is the same as no Day filter", () => {
    expect(parse("day=tue,funday,TUE").days).toEqual(["tue"]);
    expect(parse("day=sun,mon,tue,wed,thu,fri,sat").days).toEqual([]);
  });

  it("trims the text search, collapses spaces, and keeps at most 100 characters", () => {
    expect(parse("q=%20%20river%20%20%20park%20").q).toBe("river park");
    expect(parse(`q=${"a".repeat(150)}`).q).toHaveLength(100);
  });

  it("default date range is today to eight weeks later", () => {
    expect(parse("")).toEqual({ tags: [], days: [], q: "", from: TODAY, to: "2026-12-06" });
    expect(filterWindow(parse(""))).toEqual({ from: TODAY, to: "2026-12-07" });
  });

  it("default end follows a given start", () => {
    expect(parse("from=2026-11-01")).toMatchObject({ from: "2026-11-01", to: "2026-12-26" });
  });

  it("bad from or to falls back to the default; to before from is ignored", () => {
    expect(parse("from=2026-02-30&to=soon")).toMatchObject({ from: TODAY, to: "2026-12-06" });
    expect(parse("from=2026-11-01&to=2026-10-20")).toMatchObject({ from: "2026-11-01", to: "2026-12-26" });
  });

  it("a far-future from is clamped to two years after today", () => {
    expect(parse("from=9999-06-01")).toMatchObject({ from: "2028-10-11", to: "2028-10-11" });
    expect(parse("from=5000-01-01&to=5000-02-01")).toMatchObject({ from: "2028-10-11", to: "2028-10-11" });
  });

  it("a far-past from is clamped to one year before today", () => {
    expect(parse("from=1900-01-01")).toMatchObject({ from: "2025-10-12", to: "2025-12-06" });
  });

  it("to is never later than two years after today", () => {
    expect(parse("from=2028-06-01&to=2029-01-01").to).toBe("2028-10-11");
  });

  it("date range longer than 366 days is cut back", () => {
    expect(parse("from=2026-10-12&to=2028-01-01").to).toBe("2027-10-12");
  });
});

describe("serializeFilters", () => {
  it("writes keys in a fixed order and leaves out defaults", () => {
    const filters: AgendaFilters = {
      tags: ["non-drop", "group-ride"],
      days: ["thu", "tue"],
      q: "river park",
      from: TODAY,
      to: "2026-12-06",
    };
    expect(serializeFilters(filters, TODAY)).toBe("tag=group-ride,non-drop&day=tue,thu&q=river%20park");
    expect(serializeFilters(parse(""), TODAY)).toBe("");
    expect(serializeFilters(parse("from=2026-11-01"), TODAY)).toBe("from=2026-11-01");
    expect(serializeFilters(parse("to=2026-10-31"), TODAY)).toBe("to=2026-10-31");
  });

  it("serialize then parse gives the same filters", () => {
    const filters = parse("q=caf%C3%A9%2C%20%26%20bikes&tag=b,a&day=sat,mon&from=2026-11-01&to=2026-11-30");
    expect(parse(serializeFilters(filters, TODAY))).toEqual(filters);
  });
});

describe("matchesFilters", () => {
  it("an unknown or retired Tag slug matches no rows and gives no error", () => {
    // Rows carry only active Tags, so a retired slug is never on a row.
    expect(matchesFilters(row({ tags: tagged("social") }), parse("tag=retired-tag"))).toBe(false);
  });

  it("two Tags match only rows that have both", () => {
    const filters = parse("tag=non-drop,social");
    expect(matchesFilters(row({ tags: tagged("non-drop", "social", "race") }), filters)).toBe(true);
    expect(matchesFilters(row({ tags: tagged("non-drop") }), filters)).toBe(false);
  });

  it("two days match rows on either day", () => {
    const filters = parse("day=tue,thu");
    expect(matchesFilters(row({ timing: timed("2026-10-13") }), filters)).toBe(true); // Tuesday
    expect(matchesFilters(row({ timing: timed("2026-10-15") }), filters)).toBe(true); // Thursday
    expect(matchesFilters(row({ timing: timed("2026-10-14") }), filters)).toBe(false); // Wednesday
  });

  it("Day filter uses the Occurrence's wall-clock start date, not its UTC date", () => {
    // 9 pm Tuesday in Detroit is already Wednesday in UTC.
    expect(matchesFilters(row({ timing: timed("2026-10-13", "21:00", "23:00") }), parse("day=tue"))).toBe(true);
  });

  it("rescheduled Occurrence matches the Day filter of its new date, not its old date", () => {
    const moved = row({
      originalTiming: timed("2026-10-13"),
      timing: timed("2026-10-15"),
      scheduleStatus: "rescheduled",
    });
    expect(matchesFilters(moved, parse("day=thu"))).toBe(true);
    expect(matchesFilters(moved, parse("day=tue"))).toBe(false);
  });

  it("multi-day all-day Occurrence matches only the day it starts", () => {
    const weekend = row({ timing: allDay("2026-10-17", "2026-10-18") }); // Saturday and Sunday
    expect(matchesFilters(weekend, parse("day=sat"))).toBe(true);
    expect(matchesFilters(weekend, parse("day=sun"))).toBe(false);
  });

  it("text search matches title, location, description, and Tag names, case-insensitive, without accents", () => {
    const ride = row({
      title: "Café Ride",
      location: "Riverside Park",
      description: "Bring lights.",
      tags: [{ name: "Non-Drop", slug: "non-drop" }],
    });
    for (const q of ["cafe", "CAFÉ", "riverside", "lights", "non-drop"]) {
      expect(matchesFilters(ride, parse(`q=${encodeURIComponent(q)}`)), q).toBe(true);
    }
    expect(matchesFilters(ride, parse("q=gravel"))).toBe(false);
  });

  it("text search with two words needs both words", () => {
    const ride = row({ title: "Tuesday Night Ride", location: "Riverside Park" });
    expect(matchesFilters(ride, parse("q=night%20riverside"))).toBe(true);
    expect(matchesFilters(ride, parse("q=night%20gravel"))).toBe(false);
  });

  it("day, Tags, and text search together are joined with AND", () => {
    const ride = row({ timing: timed("2026-10-13"), tags: tagged("non-drop"), title: "Night Ride" });
    expect(matchesFilters(ride, parse("day=tue&tag=non-drop&q=night"))).toBe(true);
    expect(matchesFilters(ride, parse("day=wed&tag=non-drop&q=night"))).toBe(false);
    expect(matchesFilters(ride, parse("day=tue&tag=race&q=night"))).toBe(false);
    expect(matchesFilters(ride, parse("day=tue&tag=non-drop&q=gravel"))).toBe(false);
  });

  it("content match ignores the Day filter", () => {
    const ride = row({ timing: timed("2026-10-14"), tags: tagged("non-drop") });
    expect(matchesContent(ride, parse("day=tue&tag=non-drop"))).toBe(true);
  });

  it("knows when Tag, Day, or text filters are set", () => {
    expect(hasContentFilters(parse("from=2026-11-01"))).toBe(false);
    expect(hasContentFilters(parse("day=tue"))).toBe(true);
  });
});

describe("switcherFilters", () => {
  it("keeps day, search, and dates, and keeps only the Tags that the target Calendar has", () => {
    const filters = parse("tag=non-drop,meeting&day=tue&q=park&from=2026-11-01");
    const target = [{ calendar: "advocacy" as const, name: "Meeting", slug: "meeting" }];
    expect(switcherFilters(filters, "advocacy", target)).toEqual({ ...filters, tags: ["meeting"] });
  });

  it("switcher to All keeps every Tag that either Calendar has", () => {
    const filters = parse("tag=non-drop,meeting,gone");
    const all = [
      { calendar: "rides" as const, name: "Non-Drop", slug: "non-drop" },
      { calendar: "advocacy" as const, name: "Meeting", slug: "meeting" },
    ];
    expect(switcherFilters(filters, null, all).tags).toEqual(["meeting", "non-drop"]);
  });
});
