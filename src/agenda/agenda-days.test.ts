import { describe, expect, it } from "vitest";
import type { Timing } from "@/engine";
import { badgeText, groupAgendaDays } from "./agenda-days";
import { dayHeading, timeText } from "./dates";
import type { AgendaRow } from "./load-occurrences";

const WINDOW = { from: "2026-10-12", to: "2026-10-26" };

const timed = (day: string, from = "18:00", to = "20:00"): Timing => ({
  kind: "timed",
  start: `${day}T${from}`,
  end: `${day}T${to}`,
});

function row(patch: Partial<AgendaRow> & { timing: Timing }): AgendaRow {
  return {
    eventId: "e1",
    calendar: "rides",
    originalStart:
      patch.timing.kind === "timed" ? patch.timing.start : patch.timing.startDate,
    originalTiming: patch.timing,
    title: "Ride",
    description: "",
    location: null,
    imageUrl: null,
    lastModified: "2026-10-01T12:00:00.000Z",
    tags: [],
    cta: null,
    scheduleStatus: "scheduled",
    scheduleNote: null,
    ...patch,
  };
}

describe("agenda text", () => {
  it("day heading has the weekday and the date", () => {
    expect(dayHeading("2026-10-14")).toBe("Wednesday, October 14");
    expect(dayHeading("2027-01-01")).toBe("Friday, January 1");
  });

  it('timed entry shows "6:00 pm – 9:00 pm"; all-day entry shows "All day"', () => {
    expect(timeText(timed("2026-10-14", "18:00", "21:00"))).toBe("6:00 pm – 9:00 pm");
    expect(timeText(timed("2026-10-14", "00:30", "12:00"))).toBe("12:30 am – 12:00 pm");
    expect(timeText(timed("2026-10-17", "07:00", "07:00"))).toBe("7:00 am");
    expect(timeText({ kind: "allDay", startDate: "2026-10-13", endDate: "2026-10-13" })).toBe("All day");
  });

  it("multi-day entry shows its last day", () => {
    expect(timeText({ kind: "allDay", startDate: "2026-10-13", endDate: "2026-10-19" })).toBe(
      "All day, through Monday, October 19",
    );
    expect(
      timeText({ kind: "timed", start: "2026-12-14T13:00", end: "2026-12-21T15:00" }),
    ).toBe("1:00 pm – Mon, Dec 21, 3:00 pm");
  });

  it("scheduled has no badge; every other Schedule status has its badge text", () => {
    const t = timed("2026-10-14");
    expect(badgeText(row({ timing: t }))).toBeNull();
    expect(badgeText(row({ timing: t, scheduleStatus: "tentative" }))).toBe("Date to be confirmed");
    expect(badgeText(row({ timing: t, scheduleStatus: "cancelled" }))).toBe("Cancelled");
    expect(badgeText(row({ timing: t, scheduleStatus: "postponed" }))).toBe("Postponed");
    expect(
      badgeText(
        row({
          timing: timed("2026-10-16"),
          originalTiming: t,
          scheduleStatus: "rescheduled",
        }),
      ),
    ).toBe("Rescheduled from Wed, Oct 14, 6:00 pm");
  });
});

describe("groupAgendaDays", () => {
  it("groups entries by start day, in order, with headings", () => {
    const days = groupAgendaDays(
      [
        row({ timing: timed("2026-10-13"), title: "A" }),
        row({ timing: timed("2026-10-13", "19:00", "20:00"), title: "B", eventId: "e2" }),
        row({ timing: timed("2026-10-15"), title: "C" }),
      ],
      WINDOW,
    );
    expect(days.map((d) => [d.heading, d.entries.map((e) => e.row.title)])).toEqual([
      ["Tuesday, October 13", ["A", "B"]],
      ["Thursday, October 15", ["C"]],
    ]);
  });

  it("Occurrence that started before the window is listed on the first day", () => {
    const days = groupAgendaDays(
      [row({ timing: { kind: "allDay", startDate: "2026-10-10", endDate: "2026-10-13" } })],
      WINDOW,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-10-12"]);
  });

  it('rescheduled Occurrence shows "from" on the new date and "to" on the old date', () => {
    const moved = row({
      originalTiming: timed("2026-10-14"),
      originalStart: "2026-10-14T18:00",
      timing: timed("2026-10-16", "18:30", "20:30"),
      scheduleStatus: "rescheduled",
    });
    const days = groupAgendaDays([moved], WINDOW);
    expect(days.map((d) => [d.date, d.entries.map((e) => [e.kind, e.badge])])).toEqual([
      ["2026-10-14", [["movedAway", "Rescheduled to Fri, Oct 16, 6:30 pm"]]],
      ["2026-10-16", [["occurrence", "Rescheduled from Wed, Oct 14, 6:00 pm"]]],
    ]);
  });

  it("rescheduled Occurrence whose old date is outside the window shows only on the new date", () => {
    const moved = row({
      originalTiming: timed("2026-10-07"),
      originalStart: "2026-10-07T18:00",
      timing: timed("2026-10-13"),
      scheduleStatus: "rescheduled",
    });
    const days = groupAgendaDays([moved], WINDOW);
    expect(days.map((d) => [d.date, d.entries.map((e) => e.kind)])).toEqual([
      ["2026-10-13", ["occurrence"]],
    ]);
  });

  it("New date before the window, old date in the window shows only 'Rescheduled to'", () => {
    const moved = row({
      originalTiming: timed("2026-10-13"),
      originalStart: "2026-10-13T18:00",
      timing: timed("2026-10-01"),
      scheduleStatus: "rescheduled",
    });
    const days = groupAgendaDays([moved], WINDOW);
    expect(days.map((d) => [d.date, d.entries.map((e) => [e.kind, e.badge])])).toEqual([
      ["2026-10-13", [["movedAway", "Rescheduled to Thu, Oct 1, 6:00 pm"]]],
    ]);
  });

  it("timed Occurrence that ends before the window is not listed", () => {
    const days = groupAgendaDays(
      [row({ timing: { kind: "timed", start: "2026-10-11T22:00", end: "2026-10-12T00:00" } })],
      WINDOW,
    );
    expect(days).toEqual([]);
  });

  it('under a Day filter, the "Rescheduled to" entry shows on the old date when the old date matches', () => {
    const moved = row({
      originalTiming: timed("2026-10-14"), // Wednesday
      originalStart: "2026-10-14T18:00",
      timing: timed("2026-10-16", "18:30", "20:30"), // Friday
      scheduleStatus: "rescheduled",
    });
    const kinds = (days: ("wed" | "fri" | "mon")[]) =>
      groupAgendaDays([moved], WINDOW, days).map((d) => [d.date, d.entries.map((e) => e.kind)]);
    expect(kinds(["wed"])).toEqual([["2026-10-14", ["movedAway"]]]);
    expect(kinds(["fri"])).toEqual([["2026-10-16", ["occurrence"]]]);
    expect(kinds(["mon"])).toEqual([]);
  });

  it("under a Day filter, an Occurrence that starts on another day is not listed", () => {
    const days = groupAgendaDays([row({ timing: timed("2026-10-14") })], WINDOW, ["tue"]);
    expect(days).toEqual([]);
  });

  it("an Occurrence moved to a new time on the same day shows once", () => {
    const moved = row({
      originalTiming: timed("2026-10-14"),
      timing: timed("2026-10-14", "19:00", "21:00"),
      scheduleStatus: "rescheduled",
    });
    const days = groupAgendaDays([moved], WINDOW);
    expect(days).toHaveLength(1);
    expect(days[0].entries.map((e) => e.badge)).toEqual(["Rescheduled from Wed, Oct 14, 6:00 pm"]);
  });
});
