import { describe, expect, it } from "vitest";
import { parseCalendar, parseTagName, TAG_NAME_MAX } from "./rules";

describe("Tag rules", () => {
  it("Tag name is trimmed, inner spaces collapsed, and the slug comes from tagSlug", () => {
    expect(parseTagName("  Group   Ride  ")).toEqual({
      ok: true,
      value: { name: "Group Ride", slug: "group-ride" },
    });
    expect(parseTagName("Café Social")).toEqual({
      ok: true,
      value: { name: "Café Social", slug: "cafe-social" },
    });
  });

  it("Tag name with no letters or numbers is refused", () => {
    expect(parseTagName("  -- !! ")).toMatchObject({ ok: false });
    expect(parseTagName("")).toMatchObject({ ok: false });
    expect(parseTagName(null)).toMatchObject({ ok: false });
  });

  it("Tag name over 40 characters is refused", () => {
    expect(parseTagName("a".repeat(TAG_NAME_MAX))).toMatchObject({ ok: true });
    expect(parseTagName("a".repeat(TAG_NAME_MAX + 1))).toMatchObject({ ok: false });
  });

  it("Calendar must be rides or advocacy", () => {
    expect(parseCalendar("rides")).toBe("rides");
    expect(parseCalendar("advocacy")).toBe("advocacy");
    expect(parseCalendar("other")).toBeNull();
    expect(parseCalendar(null)).toBeNull();
  });
});
