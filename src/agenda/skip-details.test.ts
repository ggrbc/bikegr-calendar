import { describe, expect, it } from "vitest";
import { skipDetailsUrl } from "./skip-details";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const cta = (url: string, skipDetails = true) => ({ label: "Agenda", url, skipDetails });

describe("skipDetailsUrl", () => {
  it("a scheduled Occurrence with Skip details goes to the CTA URL; without it, no skip", () => {
    expect(skipDetailsUrl({ cta: cta("https://example.org/a"), scheduleStatus: "scheduled" })).toBe(
      "https://example.org/a",
    );
    expect(skipDetailsUrl({ cta: cta("https://example.org/a", false), scheduleStatus: "scheduled" })).toBeNull();
    expect(skipDetailsUrl({ cta: null, scheduleStatus: "scheduled" })).toBeNull();
  });

  it("an Occurrence with a Schedule status notice keeps its detail page", () => {
    for (const scheduleStatus of ["cancelled", "postponed", "tentative", "rescheduled"] as const) {
      expect(skipDetailsUrl({ cta: cta("https://example.org/a"), scheduleStatus }), scheduleStatus).toBeNull();
    }
  });

  it("a CTA URL that is a detail page of this calendar does not skip (no redirect loop)", () => {
    const own = ["calendar.bikegr.org", "localhost:3100"];
    for (const url of [
      `https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`,
      `http://localhost:3100/events/${ID}/2026-10-14`,
    ]) {
      expect(skipDetailsUrl({ cta: cta(url), scheduleStatus: "scheduled" }, own), url).toBeNull();
    }
    // Another page of this calendar, or the same path on another site, still skips.
    expect(skipDetailsUrl({ cta: cta("https://calendar.bikegr.org/rides"), scheduleStatus: "scheduled" }, own)).toBe(
      "https://calendar.bikegr.org/rides",
    );
    const other = `https://example.org/events/${ID}/2026-10-14`;
    expect(skipDetailsUrl({ cta: cta(other), scheduleStatus: "scheduled" }, own)).toBe(other);
  });
});
