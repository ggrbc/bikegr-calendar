import { describe, expect, it, vi } from "vitest";
import { captureTransport, createEmailTransport } from "./transport";

const message = { to: ["a@b.org", "c@d.org"], subject: "Hello", text: "Body text", html: "<p>Body</p>" };

describe("createEmailTransport", () => {
  it("console transport prints the recipients, the subject, and the text, and never calls Resend", async () => {
    const log = vi.fn();
    const resendFactory = vi.fn();
    const transport = createEmailTransport({ env: {}, log, resendFactory });
    expect(transport.kind).toBe("console");
    await transport.send(message);
    expect(resendFactory).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("a@b.org, c@d.org");
    expect(log.mock.calls[0][0]).toContain("Hello");
    expect(log.mock.calls[0][0]).toContain("Body text");
  });

  it("console transport is refused on every Vercel deployment", () => {
    expect(() => createEmailTransport({ env: { VERCEL: "1" } })).toThrow(/RESEND_API_KEY/);
  });

  it("resend transport sends one message to all recipients from EMAIL_FROM", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "1" }, error: null });
    const transport = createEmailTransport({
      env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "Bike GR Calendar <notifications@bikegr.org>" },
      resendFactory: () => ({ emails: { send } }),
    });
    expect(transport.kind).toBe("resend");
    await transport.send(message);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ from: "Bike GR Calendar <notifications@bikegr.org>", ...message });
  });

  it("resend transport throws when Resend returns an error", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "quota" } });
    const transport = createEmailTransport({ env: { RESEND_API_KEY: "re_test" }, resendFactory: () => ({ emails: { send } }) });
    await expect(transport.send(message)).rejects.toThrow(/Resend could not send/);
  });

  it("a subject loses its line breaks", async () => {
    const log = vi.fn();
    const transport = createEmailTransport({ env: {}, log });
    await transport.send({ ...message, subject: "One\r\nBcc: x@y.org" });
    expect(log.mock.calls[0][0]).toContain("One Bcc: x@y.org");
  });

  it("capture transport keeps each message", async () => {
    const transport = captureTransport();
    await transport.send(message);
    expect(transport.sent).toEqual([message]);
  });
});
