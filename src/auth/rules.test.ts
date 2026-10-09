import { describe, expect, it } from "vitest";
import { canInvite, canSignIn, normalizeEmail, parseInviteInput } from "./rules";

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
});

describe("parseInviteInput", () => {
  it("accepts a valid email and role, and normalizes the email", () => {
    expect(parseInviteInput({ email: " New.Editor@Example.org ", role: "editor", name: " Sam " })).toEqual({
      ok: true,
      value: { email: "new.editor@example.org", role: "editor", name: "Sam" },
    });
  });

  it("a missing name becomes null", () => {
    const result = parseInviteInput({ email: "a@b.org", role: "admin", name: "" });
    expect(result).toEqual({ ok: true, value: { email: "a@b.org", role: "admin", name: null } });
  });

  it("invite input rejects a bad email", () => {
    expect(parseInviteInput({ email: "not-an-email", role: "editor" })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: "a b@c.org", role: "editor" })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: null, role: "editor" })).toMatchObject({ ok: false });
  });

  it("invite input rejects an unknown role", () => {
    expect(parseInviteInput({ email: "a@b.org", role: "owner" })).toMatchObject({ ok: false });
  });
});
