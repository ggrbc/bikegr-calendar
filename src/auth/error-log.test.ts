/**
 * `next build` minifies server classes, so `constructor.name` becomes `N` or `eq` in production.
 * These classes have minified-style names on purpose: the log must still show a real label.
 */
import { AuthError } from "@auth/core/errors";
import { describe, expect, it } from "vitest";
import { authErrorLog } from "./error-log";

const head = (error: unknown) => authErrorLog(error).split("\n")[0];

describe("authErrorLog", () => {
  it("an Auth.js error with a minified class name logs its type", () => {
    class N extends AuthError {
      static type = "MissingCSRF" as const;
    }
    expect(head(new N("CSRF token was missing"))).toBe("[auth] Auth.js error: MissingCSRF");
  });

  it("an error with a minified class name logs the name that the class sets", () => {
    class e extends Error {
      constructor() {
        super("secret text");
        this.name = "WriteError";
      }
    }
    expect(head(new e())).toBe("[auth] Auth.js error: WriteError");
  });

  it("a driver error with a minified class name and a SQLSTATE code logs DatabaseError and the code", () => {
    class eq extends Error {
      code = "42P01";
      constructor() {
        super('relation "rate_limits" does not exist');
        this.name = this.constructor.name;
      }
    }
    expect(head(new eq())).toBe("[auth] Auth.js error: DatabaseError code=42P01");
  });

  it("keeps the stack frames and never the message text", () => {
    const line = authErrorLog(new Error("jeremy@bikegr.org"));
    expect(line.split("\n")[0]).toBe("[auth] Auth.js error: Error");
    expect(line.split("\n").slice(1).every((frame) => /^\s+at /.test(frame))).toBe(true);
    expect(line).not.toContain("jeremy");
  });

  it("a value that is not an Error logs its type", () => {
    expect(head("oops")).toBe("[auth] Auth.js error: string");
  });
});
