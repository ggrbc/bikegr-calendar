import { describe, expect, it } from "vitest";
import { assignCalendar, cleanTags, tagSlug } from "./calendar-and-tags";

describe("Calendar assignment", () => {
  it("Advocacy Tag puts the Event in the advocacy Calendar", () => {
    expect(assignCalendar("Kent County Road Commission Meeting", ["Advocacy"])).toBe("advocacy");
    expect(assignCalendar("Mobile GR Commission Meeting", ["advocacy"])).toBe("advocacy");
  });

  it("Vital Streets Oversight Commission goes to advocacy with no Tag", () => {
    expect(assignCalendar("Vital Streets Oversight Commission", [])).toBe("advocacy");
  });

  it("other Events go to rides", () => {
    expect(assignCalendar("Wednesday Evening Rides", ["Group-Ride", "Non-Drop"])).toBe("rides");
    expect(assignCalendar("Oktoberfest Ride", [])).toBe("rides");
  });
});

describe("Tag cleanup", () => {
  it("drops the Advocacy Tag", () => {
    expect(cleanTags(["Advocacy"])).toEqual([]);
  });

  it("drops weekday Tags", () => {
    expect(
      cleanTags(["Group-Ride", "Monday", "Tuesday", "Wednesday", "thursday", "Friday", "Saturday"]),
    ).toEqual(["Group-Ride"]);
    expect(cleanTags(["Sunday", "Race"])).toEqual(["Race"]);
  });

  it("an empty category gives no Tags", () => {
    expect(cleanTags([])).toEqual([]);
  });

  it("keeps the order and removes duplicates", () => {
    expect(cleanTags(["Non-Drop", "Group-Ride", "Non-Drop"])).toEqual(["Non-Drop", "Group-Ride"]);
  });

  it("Tag slugs are lowercase kebab-case", () => {
    expect(tagSlug("Group-Ride")).toBe("group-ride");
    expect(tagSlug("Charity Event")).toBe("charity-event");
    expect(tagSlug("  Kids & Family!  ")).toBe("kids-family");
  });
});
