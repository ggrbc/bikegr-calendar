import { describe, expect, it } from "vitest";
import { assignCalendar, cleanTags, tagSlug } from "./calendar-and-tags";

describe("Calendar assignment", () => {
  it("Advocacy category puts the Event in the advocacy Calendar", () => {
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
  const names = (categories: string[]) => cleanTags(categories).map((tag) => tag.name);

  it("drops the Advocacy category", () => {
    expect(cleanTags(["Advocacy"])).toEqual([]);
  });

  it("drops weekday Tags", () => {
    expect(
      names(["Group-Ride", "Monday", "Tuesday", "Wednesday", "thursday", "Friday", "Saturday"]),
    ).toEqual(["Group-Ride"]);
    expect(names(["Sunday", "Race"])).toEqual(["Race"]);
  });

  it("an empty category gives no Tags", () => {
    expect(cleanTags([])).toEqual([]);
  });

  it("gives each Tag a name and a slug, in the order of the categories", () => {
    expect(cleanTags(["Non-Drop", "Group-Ride"])).toEqual([
      { name: "Non-Drop", slug: "non-drop" },
      { name: "Group-Ride", slug: "group-ride" },
    ]);
  });

  it("removes Tags whose slug repeats, and keeps the first name", () => {
    expect(cleanTags(["Group-Ride", "Group Ride", "group-ride"])).toEqual([
      { name: "Group-Ride", slug: "group-ride" },
    ]);
  });

  it("drops Tags with an empty slug", () => {
    expect(cleanTags(["Café Ride", "🚲"])).toEqual([{ name: "Café Ride", slug: "cafe-ride" }]);
  });

  it("Tag slugs are lowercase kebab-case", () => {
    expect(tagSlug("Group-Ride")).toBe("group-ride");
    expect(tagSlug("Charity Event")).toBe("charity-event");
    expect(tagSlug("  Kids & Family!  ")).toBe("kids-family");
  });

  it("Tag slugs change accented letters to plain letters", () => {
    expect(tagSlug("Café")).toBe("cafe");
    expect(tagSlug("Señor Søren Ride")).toBe("senor-s-ren-ride");
  });
});
