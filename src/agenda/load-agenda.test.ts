import { describe, expect, it } from "vitest";
import { parseFilters } from "./filters";
import { loadAgenda } from "./load-agenda";
import type { CalendarSnapshot } from "./snapshot";
import { snapshotEvent, timed } from "./test-fixtures";

const TODAY = "2026-10-12";
/** Two weeks unless the query sets `to`. */
const filters = (query: string) =>
  parseFilters(new URLSearchParams(query.includes("to=") ? query : `to=2026-10-25&${query}`), TODAY);

const snapshot: CalendarSnapshot = {
  events: [
    snapshotEvent({
      title: "Tuesday Ride",
      timing: timed("2026-10-13"),
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      tags: [{ name: "Non-Drop", slug: "non-drop" }],
    }),
    snapshotEvent({ id: "11111111-2222-4333-8444-555555555555", title: "Thursday Ride", timing: timed("2026-10-15") }),
  ],
  tags: [{ calendar: "rides", name: "Non-Drop", slug: "non-drop" }],
};

describe("loadAgenda", () => {
  it("gives the days and the Calendar's Tags when the query works", async () => {
    const agenda = await loadAgenda(async () => snapshot, filters(""), () => {});
    expect(agenda.ok && agenda.days.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-15", "2026-10-20"]);
    expect(agenda.ok && agenda.tags).toEqual(snapshot.tags);
  });

  it("applies the date range, Tags, text search, and days", async () => {
    const dates = async (query: string) => {
      const agenda = await loadAgenda(async () => snapshot, filters(query), () => {});
      return agenda.ok ? agenda.days.map((d) => d.date) : null;
    };
    expect(await dates("tag=non-drop")).toEqual(["2026-10-13", "2026-10-20"]);
    expect(await dates("q=thursday")).toEqual(["2026-10-15"]);
    expect(await dates("day=thu")).toEqual(["2026-10-15"]);
    expect(await dates("from=2026-10-14&to=2026-10-19")).toEqual(["2026-10-15"]);
    expect(await dates("tag=retired")).toEqual([]);
  });

  it("an error while the engine expands gives the fallback, not an error page", async () => {
    const logged: string[] = [];
    const broken: CalendarSnapshot = { events: [snapshotEvent({ rrule: "FREQ=NOPE" })], tags: [] };
    const agenda = await loadAgenda(async () => broken, filters(""), (line) => logged.push(line));
    expect(agenda).toEqual({ ok: false });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^Agenda could not load: /);
  });

  it("a database error gives the fallback and logs only the error name and code", async () => {
    const logged: string[] = [];
    const cause = Object.assign(
      new Error("connect to postgresql://u:npg_Secret123@ep-x-1.aws.neon.tech/db failed"),
      { code: "ECONNREFUSED" },
    );
    const error = Object.assign(new Error("Failed query: select … params: npg_Secret123"), {
      name: "DrizzleQueryError",
      cause,
    });
    const agenda = await loadAgenda(
      async () => {
        throw error;
      },
      filters(""),
      (line) => logged.push(line),
    );
    expect(agenda).toEqual({ ok: false });
    expect(logged).toEqual(["Agenda could not load: DrizzleQueryError (ECONNREFUSED)"]);
    expect(logged.join()).not.toMatch(/npg_|ep-x|postgresql/);
  });
});
