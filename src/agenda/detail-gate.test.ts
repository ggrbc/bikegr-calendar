import { describe, expect, it } from "vitest";
import { detailGate, statusPageHtml } from "./detail-gate";
import type { FindResult } from "./find-occurrence";
import { row, snapshotEvent } from "./test-fixtures";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const found: FindResult = { kind: "found", row: row(), event: snapshotEvent() };

describe("detailGate", () => {
  it("unknown Occurrence gives 404, deleted Event gives 410, known Occurrence goes through", async () => {
    expect(await detailGate(`/events/${ID}/2026-10-14T1800`, async () => ({ kind: "missing" }))).toEqual({
      kind: "status",
      status: 404,
    });
    expect(
      await detailGate(`/events/${ID}/2026-10-14T1800`, async () => ({ kind: "gone", calendar: "rides" })),
    ).toEqual({ kind: "status", status: 410 });
    expect(await detailGate(`/events/${ID}/2026-10-14T1800`, async () => found)).toEqual({ kind: "next" });
  });

  it("an Event that skips its details page redirects the page to the CTA URL, not the .ics file", async () => {
    const cta = { label: "League", url: "https://example.org/league", skipDetails: true };
    const skip: FindResult = { kind: "found", row: row({ cta }), event: snapshotEvent({ cta }) };
    expect(await detailGate(`/events/${ID}/2026-10-14T1800`, async () => skip)).toEqual({
      kind: "redirect",
      url: "https://example.org/league",
    });
    expect(await detailGate(`/events/${ID}/2026-10-14T1800/event.ics`, async () => skip)).toEqual({ kind: "next" });
    const keep: FindResult = { kind: "found", row: row({ cta: { ...cta, skipDetails: false } }), event: snapshotEvent() };
    expect(await detailGate(`/events/${ID}/2026-10-14T1800`, async () => keep)).toEqual({ kind: "next" });
  });

  it("Skip details shows the page for a cancelled Occurrence and for a CTA URL to this calendar's own detail page", async () => {
    const path = `/events/${ID}/2026-10-14T1800`;
    const skipping = (url: string, scheduleStatus: "scheduled" | "cancelled" = "scheduled"): FindResult => {
      const cta = { label: "Agenda", url, skipDetails: true };
      return { kind: "found", row: row({ cta, scheduleStatus }), event: snapshotEvent({ cta }) };
    };
    const cancelled = skipping("https://example.org/league", "cancelled");
    expect(await detailGate(path, async () => cancelled)).toEqual({ kind: "next" });
    const loop = skipping(`http://localhost:3100${path}`);
    const gate = (result: FindResult) =>
      detailGate(path, async () => result, () => {}, undefined, ["calendar.bikegr.org", "localhost:3100"]);
    expect(await gate(loop)).toEqual({ kind: "next" });
    expect(await gate(skipping(`https://calendar.bikegr.org${path}`))).toEqual({ kind: "next" });
  });

  it("checks the .ics path the same way, and passes the id and segment", async () => {
    const calls: string[][] = [];
    await detailGate(`/events/${ID}/2026-10-14/event.ics`, async (id, segment) => {
      calls.push([id, segment]);
      return { kind: "missing" };
    });
    expect(calls).toEqual([[ID, "2026-10-14"]]);
  });

  it("other /events paths go through without a database read", async () => {
    const find = async (): Promise<FindResult> => {
      throw new Error("must not be called");
    };
    expect(await detailGate("/events", find)).toEqual({ kind: "next" });
    expect(await detailGate(`/events/${ID}/x/y`, find)).toEqual({ kind: "next" });
  });

  it("a bad id, a bad start, or a start out of range gives 404 without a database read", async () => {
    const find = async (): Promise<FindResult> => {
      throw new Error("must not be called");
    };
    for (const path of [
      "/events/spike/2026-10-14T1800",
      `/events/${ID}/2026-10-14T18:00`,
      `/events/${ID}/9999-12-31T1800`,
      `/events/${ID}/1999-01-01`,
    ]) {
      expect(await detailGate(path, find, () => {}, "2026-10-12"), path).toEqual({ kind: "status", status: 404 });
    }
  });

  it("a database error lets the request through and logs only the error name and code", async () => {
    const logged: string[] = [];
    const error = Object.assign(new Error("connect postgresql://u:npg_x@ep-y.neon.tech failed"), { code: "ETIMEDOUT" });
    const decision = await detailGate(
      `/events/${ID}/2026-10-14T1800`,
      async () => {
        throw error;
      },
      (line) => logged.push(line),
    );
    expect(decision).toEqual({ kind: "next" });
    expect(logged).toEqual(["Detail check could not load: Error (ETIMEDOUT)"]);
  });

  it("status pages are noindex and link to the Calendars", () => {
    for (const status of [404, 410] as const) {
      const html = statusPageHtml(status);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('href="/rides"');
    }
    expect(statusPageHtml(410)).toContain("removed");
  });
});
