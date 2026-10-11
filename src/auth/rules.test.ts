import { describe, expect, it } from "vitest";
import { canInvite, canSignIn, isValidEmail, normalizeEmail, parseEditorName, parseInviteInput } from "./rules";

describe("canSignIn", () => {
  it("invited active Editor may sign in", () => {
    expect(canSignIn({ deactivatedAt: null })).toBe(true);
  });

  it("unknown email is refused", () => {
    expect(canSignIn(null)).toBe(false);
    expect(canSignIn(undefined)).toBe(false);
  });

  it("deactivated Editor is refused", () => {
    expect(canSignIn({ deactivatedAt: new Date("2026-10-01T12:00:00Z") })).toBe(false);
  });
});

describe("canInvite", () => {
  it("only an active Admin may invite", () => {
    expect(canInvite({ role: "admin", deactivatedAt: null })).toBe(true);
    expect(canInvite({ role: "editor", deactivatedAt: null })).toBe(false);
    expect(canInvite({ role: "admin", deactivatedAt: new Date() })).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("email lookup ignores case and spaces", () => {
    expect(normalizeEmail("  Jeremy@BikeGR.org ")).toBe("jeremy@bikegr.org");
  });

  it("applies NFKC, so look-alike characters become plain ASCII", () => {
    // U+FF20 FULLWIDTH COMMERCIAL AT and fullwidth letters.
    expect(normalizeEmail("ｊｅｒｅｍｙ＠bikegr.org")).toBe("jeremy@bikegr.org");
  });
});

describe("isValidEmail", () => {
  it("accepts a plain address", () => {
    expect(isValidEmail("new.editor+tag@example.org")).toBe(true);
  });

  it('refuses ", comma, <, and >, which can split one address into several', () => {
    for (const bad of ['"a"@b.org', "a,b@c.org", "a@b.org,c@d.org", "<a@b.org>", "a@b.org>"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("refuses control and format characters (NUL, BEL, DEL, zero-width space, RTL override)", () => {
    for (const bad of ["jeremy\0@bikegr.org", "a\u0007b@c.org", "a@b\u007f.org", "a​@b.org", "a@‮b.org"]) {
      expect(isValidEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses the other RFC 5322 specials, which need quotes (and quotes are refused)", () => {
    for (const bad of ["a(b)@c.org", "a[b]@c.org", "a:b@c.org", "a;b@c.org", "a\\b@c.org", "a@[127.0.0.1]"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("still accepts common real addresses", () => {
    for (const good of ["first.last@sub.example.org", "o'neil@example.org", "a_b-c+d@ex-ample.co.uk"]) {
      expect(isValidEmail(good), good).toBe(true);
    }
  });
});

describe("parseInviteInput", () => {
  it("accepts a valid email and role, and normalizes the email", () => {
    expect(parseInviteInput({ email: " New.Editor@Example.org ", role: "editor", name: " Sam " })).toEqual({
      ok: true,
      value: { email: "new.editor@example.org", role: "editor", name: "Sam" },
    });
  });

  it("a missing, empty, or blank name is refused", () => {
    for (const name of [undefined, "", "   ", null]) {
      expect(parseInviteInput({ email: "a@b.org", role: "admin", name }), String(name)).toMatchObject({ ok: false });
    }
  });

  it("a name with a control character is refused", () => {
    expect(parseInviteInput({ email: "a@b.org", role: "admin", name: "Sam\u0000" })).toMatchObject({ ok: false });
  });

  it("invite input rejects a bad email", () => {
    expect(parseInviteInput({ email: "not-an-email", role: "editor", name: "Sam" })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: "a b@c.org", role: "editor", name: "Sam" })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: null, role: "editor", name: "Sam" })).toMatchObject({ ok: false });
  });

  it("invite input rejects an unknown role", () => {
    expect(parseInviteInput({ email: "a@b.org", role: "owner", name: "Sam" })).toMatchObject({ ok: false });
  });
});

describe("parseEditorName", () => {
  it("trims the name", () => {
    expect(parseEditorName("  Sam Rider ")).toEqual({ ok: true, value: "Sam Rider" });
  });

  it("refuses empty text, blank text, and a non-string", () => {
    for (const raw of ["", "   ", "\t\n", null, undefined, 5]) {
      expect(parseEditorName(raw), String(raw)).toMatchObject({ ok: false, error: "Enter a name." });
    }
  });

  it("allows 100 characters and refuses 101", () => {
    expect(parseEditorName("a".repeat(100))).toMatchObject({ ok: true });
    expect(parseEditorName("a".repeat(101))).toMatchObject({ ok: false });
  });

  it("counts code points, not UTF-16 units, against the limit", () => {
    expect(parseEditorName("\u{1F600}".repeat(100))).toMatchObject({ ok: true });
    expect(parseEditorName("\u{1F600}".repeat(101))).toMatchObject({ ok: false });
  });

  it("refuses control characters", () => {
    for (const bad of ["Sam\u0000", "Sam\nRider", "Sam\tRider", "Sam\u007f"]) {
      expect(parseEditorName(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("refuses invisible format characters", () => {
    // Zero-width space, word joiner, BOM inside the text, soft hyphen.
    for (const bad of ["Sam\u200bRider", "Sam\u2060Rider", "Sam\ufeffRider", "Ann\u00adMarie"]) {
      expect(parseEditorName(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("refuses bidi controls", () => {
    const bidi = ["\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e"];
    bidi.push("\u2066", "\u2067", "\u2068", "\u2069", "\u061c");
    for (const mark of bidi) {
      expect(parseEditorName(`Sam${mark}Rider`), JSON.stringify(mark)).toMatchObject({ ok: false });
    }
  });

  it("refuses line and paragraph separators and a lone surrogate", () => {
    for (const bad of ["Sam\u2028Rider", "Sam\u2029Rider", "Sam\ud800"]) {
      expect(parseEditorName(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("allows ZWNJ and ZWJ, which Persian, Indic, and emoji names use", () => {
    const good = ["\u0645\u0647\u0631\u200c\u0646\u0648\u0634", "Sam \u{1F468}\u200d\u{1F469}\u200d\u{1F467}"];
    for (const name of good) expect(parseEditorName(name), JSON.stringify(name)).toMatchObject({ ok: true });
  });

  it("refuses a name with no visible character", () => {
    const blanks = ["\u3164", "\u2800", "\u115f", "\u1160", "\uffa0", "\u00a0", "\u3000", " \u3164\u2800 ", "\u200c\u200d"];
    for (const blank of blanks) {
      expect(parseEditorName(blank), JSON.stringify(blank)).toMatchObject({ ok: false, error: "Enter a name." });
    }
  });

  it("keeps ordinary names with accents, apostrophes, and hyphens", () => {
    for (const good of ["José Núñez", "Mary O'Neil", "Ann-Marie Smith", "李雷"]) {
      expect(parseEditorName(good), good).toEqual({ ok: true, value: good });
    }
  });
});
