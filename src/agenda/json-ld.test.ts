import { describe, expect, it } from "vitest";
import type { ScheduleStatus } from "@/engine";
import { eventJsonLd, jsonLdText } from "./json-ld";
import { allDay, row, timed } from "./test-fixtures";

const URL = "https://calendar.bikegr.org/events/x/2026-10-14T1800";

describe("eventJsonLd", () => {
  it("each Schedule status gives its eventStatus", () => {
    const expected: Record<ScheduleStatus, string> = {
      scheduled: "EventScheduled",
      tentative: "EventScheduled",
      cancelled: "EventCancelled",
      postponed: "EventPostponed",
      rescheduled: "EventRescheduled",
    };
    for (const [status, value] of Object.entries(expected)) {
      expect(eventJsonLd(row({ scheduleStatus: status as ScheduleStatus }), URL).eventStatus).toBe(
        `https://schema.org/${value}`,
      );
    }
  });

  it("rescheduled Occurrence has previousStartDate", () => {
    const json = eventJsonLd(
      row({ originalTiming: timed("2026-10-13"), timing: timed("2026-10-15"), scheduleStatus: "rescheduled" }),
      URL,
    );
    expect(json.previousStartDate).toBe("2026-10-13T18:00:00-04:00");
    expect(json.startDate).toBe("2026-10-15T18:00:00-04:00");
  });

  it("timed dates have the Detroit offset; all-day dates have no time", () => {
    expect(eventJsonLd(row({ timing: timed("2026-12-01", "18:00", "21:00") }), URL)).toMatchObject({
      startDate: "2026-12-01T18:00:00-05:00",
      endDate: "2026-12-01T21:00:00-05:00",
    });
    expect(eventJsonLd(row({ timing: allDay("2026-10-17", "2026-10-18") }), URL)).toMatchObject({
      startDate: "2026-10-17",
      endDate: "2026-10-18",
    });
  });

  it("has the name, URL, organizer, location, image, and description", () => {
    const json = eventJsonLd(
      row({ location: "Riverside Park", imageUrl: "https://blob.example/a.jpg", description: "Bring lights." }),
      URL,
    );
    expect(json).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Tuesday Night Ride",
      url: URL,
      description: "Bring lights.",
      location: { "@type": "Place", name: "Riverside Park", address: "Riverside Park" },
      image: ["https://blob.example/a.jpg"],
      organizer: { "@type": "Organization", name: "Greater Grand Rapids Bicycle Coalition" },
    });
  });

  it("uses the Custom Preview, else the description without Markdown", () => {
    expect(eventJsonLd(row({ description: "**Bring** lights", preview: "Easy pace." }), URL).description).toBe("Easy pace.");
    expect(eventJsonLd(row({ description: "**Bring** lights" }), URL).description).toBe("Bring lights");
  });

  it("no location, no image, and a zero-length time give no location, image, or endDate keys", () => {
    const json = eventJsonLd(row({ timing: timed("2026-10-14", "07:00", "07:00") }), URL);
    expect(Object.keys(json)).not.toContain("location");
    expect(Object.keys(json)).not.toContain("image");
    expect(Object.keys(json)).not.toContain("endDate");
    expect(Object.keys(json)).not.toContain("description");
  });
});

describe("jsonLdText", () => {
  it("</script> in a title or description cannot close the script tag", () => {
    const text = jsonLdText(eventJsonLd(row({ title: "</script><script>alert(1)</script>" }), URL));
    expect(text).not.toContain("<");
    expect(JSON.parse(text).name).toBe("</script><script>alert(1)</script>");
  });
});
