/** The login server action, with Auth.js mocked: bad input never reaches `signIn()`. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
const googleSignInEnabled = vi.fn(() => true);
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});
vi.mock("@/auth", () => ({ signIn, googleSignInEnabled, LOGIN_PATH: "/login" }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/navigation", () => ({ redirect }));

const { requestMagicLink, signInWithGoogle } = await import("./actions");

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

describe("signInWithGoogle", () => {
  beforeEach(() => signIn.mockReset());

  it("calls signIn('google') with redirectTo /admin, and lets its redirect (to Google) through", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;https://accounts.google.com/;307;" });
    signIn.mockRejectedValueOnce(redirect);
    await expect(signInWithGoogle()).rejects.toBe(redirect);
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/admin" });
  });

  it("with no Google client, redirects to /login and calls no signIn", async () => {
    googleSignInEnabled.mockReturnValueOnce(false);
    await expect(signInWithGoogle()).rejects.toMatchObject({ url: "/login" });
    expect(signIn).not.toHaveBeenCalled();
  });
});
