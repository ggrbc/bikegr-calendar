import { describe, expect, it } from "vitest";
import { googleSignInEmail, isGoogleAuthoritative } from "./google";

describe("googleSignInEmail", () => {
  it("a verified email is normalized (NFKC, trim, lowercase)", () => {
    expect(googleSignInEmail({ email: " Jeremy＠BikeGR.org ", email_verified: true })).toBe("jeremy@bikegr.org");
  });

  it("email_verified false gives null", () => {
    expect(googleSignInEmail({ email: "jeremy@bikegr.org", email_verified: false })).toBeNull();
  });

  it("a missing email_verified gives null (only the boolean true counts)", () => {
    expect(googleSignInEmail({ email: "jeremy@bikegr.org" })).toBeNull();
    expect(googleSignInEmail({ email: "jeremy@bikegr.org", email_verified: "true" })).toBeNull();
  });

  it("a missing or invalid email gives null", () => {
    expect(googleSignInEmail({ email_verified: true })).toBeNull();
    expect(googleSignInEmail({ email: "not an email", email_verified: true })).toBeNull();
    expect(googleSignInEmail({ email: "a\0@bikegr.org", email_verified: true })).toBeNull();
  });
});

describe("isGoogleAuthoritative", () => {
  it("a Gmail address with no hd is authoritative", () => {
    expect(isGoogleAuthoritative({ email: "rider@gmail.com" })).toBe(true);
  });

  it("a Workspace account whose hd equals its email domain is authoritative", () => {
    expect(isGoogleAuthoritative({ email: "jeremy@bikegr.org", hd: "bikegr.org" })).toBe(true);
    expect(isGoogleAuthoritative({ email: "pat@company.example", hd: "Company.Example" })).toBe(true);
  });

  it("a Google account made on another provider's address (no hd) is not authoritative", () => {
    expect(isGoogleAuthoritative({ email: "rider@yahoo.com" })).toBe(false);
    expect(isGoogleAuthoritative({ email: "jeremy@bikegr.org" })).toBe(false);
  });

  it("an hd that differs from the email domain is not authoritative", () => {
    expect(isGoogleAuthoritative({ email: "jeremy@bikegr.org", hd: "other.example" })).toBe(false);
    expect(isGoogleAuthoritative({ email: "rider@gmail.com", hd: "other.example" })).toBe(false);
  });

  it("a look-alike domain is not Gmail", () => {
    expect(isGoogleAuthoritative({ email: "rider@gmail.com.evil.example" })).toBe(false);
    expect(isGoogleAuthoritative({ email: "rider@notgmail.com" })).toBe(false);
  });

  it("no email is not authoritative", () => {
    expect(isGoogleAuthoritative({ hd: "bikegr.org" })).toBe(false);
  });
});
