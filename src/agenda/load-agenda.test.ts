import { describe, expect, it } from "vitest";
import { loadAgenda } from "./load-agenda";

const WINDOW = { from: "2026-10-12", to: "2026-10-26" };

describe("loadAgenda", () => {
  it("gives the days when the query works", async () => {
    const agenda = await loadAgenda(
      async () => [
        {
          eventId: "e1",
          calendar: "rides",
          originalStart: "2026-10-13T18:00",
          timing: { kind: "timed", start: "2026-10-13T18:00", end: "2026-10-13T20:00" },
          originalTiming: { kind: "timed", start: "2026-10-13T18:00", end: "2026-10-13T20:00" },
          title: "Ride",
          location: null,
          tags: [],
          cta: null,
          scheduleStatus: "scheduled",
          scheduleNote: null,
        },
      ],
      WINDOW,
      () => {},
    );
    expect(agenda.ok && agenda.days.map((d) => d.date)).toEqual(["2026-10-13"]);
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
      WINDOW,
      (line) => logged.push(line),
    );
    expect(agenda).toEqual({ ok: false });
    expect(logged).toEqual(["Agenda could not load: DrizzleQueryError (ECONNREFUSED)"]);
    expect(logged.join()).not.toMatch(/npg_|ep-x|postgresql/);
  });
});
