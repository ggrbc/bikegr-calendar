import { describe, expect, it, vi } from "vitest";
import { composeMagicLinkEmail, createMailer, magicLinkKind } from "./mailer";

const url = "http://localhost:3000/api/auth/callback/resend?token=abc&email=a%40b.org";

describe("magicLinkKind", () => {
  it("first login gets invite text", () => {
    expect(magicLinkKind({ emailVerified: null })).toBe("invite");
  });

  it("a later login gets sign-in text", () => {
    expect(magicLinkKind({ emailVerified: new Date() })).toBe("sign-in");
  });
});

describe("composeMagicLinkEmail", () => {
  it("invite text says the person is invited and can get a new link", () => {
    const email = composeMagicLinkEmail({ url, kind: "invite", loginUrl: "http://localhost:3000/login" });
    expect(email.subject).toMatch(/invited/i);
    expect(email.text).toContain(url);
    expect(email.text).toContain("http://localhost:3000/login");
    expect(email.html).toContain("token=abc&amp;email");
  });

  it("sign-in text has the link", () => {
    const email = composeMagicLinkEmail({ url, kind: "sign-in", loginUrl: "http://x/login" });
    expect(email.subject).toMatch(/sign in/i);
    expect(email.text).toContain(url);
  });
});

describe("createMailer", () => {
  it("console transport prints the link", async () => {
    const log = vi.fn();
    const resendFactory = vi.fn();
    const mailer = createMailer({ env: {}, log, resendFactory });
    expect(mailer.transport).toBe("console");

    await mailer.sendMagicLink({ to: "a@b.org", url, kind: "sign-in", loginUrl: "http://x/login" });

    expect(resendFactory).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain(url);
    expect(log.mock.calls[0][0]).toContain("a@b.org");
  });

  it("console transport is refused on every Vercel deployment, Preview included", () => {
    expect(() => createMailer({ env: { VERCEL: "1", VERCEL_ENV: "production" } })).toThrow(/RESEND_API_KEY/);
    expect(() => createMailer({ env: { VERCEL: "1", VERCEL_ENV: "preview" } })).toThrow(/RESEND_API_KEY/);
  });

  it("resend transport sends the link", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "1" }, error: null });
    const resendFactory = vi.fn().mockReturnValue({ emails: { send } });
    const mailer = createMailer({
      env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "Bike GR Calendar <no-reply@calendar.bikegr.org>" },
      resendFactory,
    });
    expect(mailer.transport).toBe("resend");

    await mailer.sendMagicLink({ to: "a@b.org", url, kind: "invite", loginUrl: "http://x/login" });

    expect(resendFactory).toHaveBeenCalledWith("re_test");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Bike GR Calendar <no-reply@calendar.bikegr.org>",
        to: "a@b.org",
        subject: expect.stringMatching(/invited/i),
        text: expect.stringContaining(url),
      }),
    );
  });

  it("resend transport throws when Resend returns an error", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const mailer = createMailer({
      env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "x@y.org" },
      resendFactory: () => ({ emails: { send } }),
    });
    await expect(
      mailer.sendMagicLink({ to: "a@b.org", url, kind: "sign-in", loginUrl: "http://x/login" }),
    ).rejects.toThrow(/domain not verified/);
  });
});
