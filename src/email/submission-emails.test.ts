import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html";
import { composeApprovedEmail, composeNewSubmissionEmail, composeRejectedEmail } from "./submission-emails";

const hostile = `Ride <script>alert("x")</script> & 'friends'`;

describe("escapeHtml", () => {
  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("new-Submission email to Editors", () => {
  const email = composeNewSubmissionEmail({
    calendar: "advocacy",
    title: hostile,
    when: "Tue, Oct 13 · 6:00 pm",
    submitterName: "Sam <Submitter>",
    reviewUrl: "http://localhost:3000/admin/events/abc?x=1&y=2",
    queueUrl: "http://localhost:3000/admin/review",
  });

  it("has the Calendar and the title in the subject", () => {
    expect(email.subject).toBe(`New Submission for Advocacy: ${hostile}`);
  });

  it("has the review link and the queue link in the text and the HTML", () => {
    expect(email.text).toContain("http://localhost:3000/admin/events/abc?x=1&y=2");
    expect(email.text).toContain("http://localhost:3000/admin/review");
    expect(email.html).toContain('href="http://localhost:3000/admin/events/abc?x=1&amp;y=2"');
    expect(email.html).toContain('href="http://localhost:3000/admin/review"');
  });

  it("escapes the title and the Submitter name in the HTML", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Ride &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;");
    expect(email.html).toContain("Sam &lt;Submitter&gt;");
    expect(email.text).toContain("Sam <Submitter>");
    expect(email.text).toContain("Tue, Oct 13 · 6:00 pm");
  });
});

describe("approve email to the Submitter", () => {
  const email = composeApprovedEmail({
    calendar: "rides",
    title: hostile,
    eventUrl: "https://calendar.bikegr.org/events/abc/2026-10-13T1800",
  });

  it("says the event is public, with its link", () => {
    expect(email.subject).toMatch(/is on the Bike GR Calendar/);
    expect(email.text).toContain("Rides & Events");
    expect(email.text).toContain("https://calendar.bikegr.org/events/abc/2026-10-13T1800");
    expect(email.html).toContain('href="https://calendar.bikegr.org/events/abc/2026-10-13T1800"');
    expect(email.html).not.toContain("<script>");
  });
});

describe("reject email to the Submitter", () => {
  it("gives the reason when there is one, escaped in the HTML", () => {
    const email = composeRejectedEmail({ calendar: "rides", title: "Ride", reason: "Not a <bike> event." });
    expect(email.subject).toMatch(/not added/);
    expect(email.text).toContain("Not a <bike> event.");
    expect(email.html).toContain("Not a &lt;bike&gt; event.");
  });

  it("has no reason line when there is no reason", () => {
    const email = composeRejectedEmail({ calendar: "rides", title: "Ride", reason: null });
    expect(email.text).not.toMatch(/Reason/);
    expect(email.html).not.toMatch(/Reason/);
  });
});
