import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { row } from "@/agenda/test-fixtures";
import { buildCalendarFile } from "./vevent";

const NOW = new Date("2026-10-12T15:00:00.000Z");
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function description(patch: Parameters<typeof row>[0]) {
  const text = buildCalendarFile({ name: "Test", rows: [row(patch)], now: NOW });
  const event = new ICAL.Component(ICAL.parse(text)).getAllSubcomponents("vevent")[0];
  return event.getFirstPropertyValue("description");
}

describe("Occurrence details in the Feed", () => {
  it("come after the status and before the Event description", () => {
    expect(
      description({
        scheduleStatus: "tentative",
        scheduleNote: "Check the weather",
        occurrenceDetails: "Route: Millennium Park loop.\nOff-road tires.",
        description: "Weekly ride.",
      }),
    ).toBe(
      [
        "Date to be confirmed — Check the weather",
        "Route: Millennium Park loop.\nOff-road tires.",
        "Weekly ride.",
        `https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`,
      ].join("\n\n"),
    );
  });

  it("are left out when there are none", () => {
    expect(description({ description: "Weekly ride." })).toBe(
      ["Weekly ride.", `https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`].join("\n\n"),
    );
  });
});
