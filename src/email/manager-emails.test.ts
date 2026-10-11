import { describe, expect, it } from "vitest";
import { composeManagerGrantEmail } from "./manager-emails";
import { notifyManagerGranted } from "./notify";
import type { EmailMessage, EmailTransport } from "./transport";

describe("the manager grant email", () => {
  it("has the subject, the Event title, and a sign-in link", () => {
    const email = composeManagerGrantEmail({ title: "Wednesday Evening Ride", signInUrl: "https://calendar.bikegr.org/login" });
    expect(email.subject).toBe("You can now manage Wednesday Evening Ride");
    expect(email.text).toContain("Wednesday Evening Ride");
    expect(email.text).toContain("https://calendar.bikegr.org/login");
  });

  it("escapes the title in the HTML", () => {
    const email = composeManagerGrantEmail({ title: `<img src=x onerror="a()"> & Co`, signInUrl: "https://x.org/login" });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });

  it("is sent to one person, and a send error never throws", async () => {
    const sent: EmailMessage[] = [];
    const transport: EmailTransport = { kind: "capture", send: async (m) => void sent.push(m) };
    expect(await notifyManagerGranted(transport, { to: "sam@example.org", title: "Ride" }, "https://calendar.bikegr.org")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["sam@example.org"]);
    expect(sent[0].text).toContain("https://calendar.bikegr.org/login");

    const logs: string[] = [];
    const failing: EmailTransport = { kind: "capture", send: async () => { throw new Error("boom sam@example.org"); } };
    await expect(
      notifyManagerGranted(failing, { to: "sam@example.org", title: "Ride" }, "https://x.org", (line) => logs.push(line)),
    ).resolves.toBe(false);
    expect(logs.join("")).not.toContain("sam@example.org");
  });
});
