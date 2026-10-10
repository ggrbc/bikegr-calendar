/** The login server action, with Auth.js mocked: bad input never reaches `signIn()`. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
vi.mock("@/auth", () => ({ signIn }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

const { requestMagicLink } = await import("./actions");

function form(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

describe("requestMagicLink", () => {
  beforeEach(() => signIn.mockReset());

  it("an email with a NUL byte (jeremy%00%40bikegr.org) gets the invalid-email answer and calls no signIn", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" "))),
    );

    const state = await requestMagicLink({ result: "idle" }, form(decodeURIComponent("jeremy%00%40bikegr.org")));
    expect(state).toEqual({ result: "error", message: "Enter a valid email address." });
    expect(signIn).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("jeremy");
    spies.forEach((spy) => spy.mockRestore());
  });

  it("a valid email calls signIn with the normalized email", async () => {
    const state = await requestMagicLink({ result: "idle" }, form(" Jeremy@BikeGR.org "));
    expect(state).toEqual({ result: "sent", email: "jeremy@bikegr.org" });
    expect(signIn).toHaveBeenCalledWith("resend", { email: "jeremy@bikegr.org", redirect: false, redirectTo: "/admin" });
  });
});
