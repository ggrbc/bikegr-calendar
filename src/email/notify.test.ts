import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addEditor, draft } from "@/admin/events/test-helpers";
import { editors } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { appOrigin, notifyApproved, notifyNewSubmission, notifyRejected } from "./notify";
import { captureTransport, type EmailTransport } from "./transport";

const ORIGIN = "http://localhost:3000";
const submitted = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  draft: draft({ calendar: "advocacy", title: "Commission <b>Meeting</b>" }),
  submitter: { name: "Sam Rider", email: "sam@example.org" },
};

describe("appOrigin", () => {
  it("uses the AUTH_URL origin, else the production site", () => {
    expect(appOrigin({ AUTH_URL: "http://localhost:3000/api/auth" })).toBe("http://localhost:3000");
    expect(appOrigin({})).toBe("https://calendar.bikegr.org");
    expect(appOrigin({ AUTH_URL: "not a url" })).toBe("https://calendar.bikegr.org");
  });
});

describe("notifyNewSubmission", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => close());

  it("sends one email to all active Editors, not to a deactivated one, with the Calendar in the subject", async () => {
    await addEditor(db, "Erin Editor");
    await addEditor(db, "Ada Admin", "admin");
    const gone = await addEditor(db, "Old Editor");
    await db.update(editors).set({ deactivatedAt: new Date() }).where(eq(editors.id, gone.id));
    const transport = captureTransport();

    await notifyNewSubmission(db, transport, submitted, ORIGIN);

    expect(transport.sent).toHaveLength(1);
    const [email] = transport.sent;
    expect(email.to.sort()).toEqual(["ada.admin@example.org", "erin.editor@example.org"]);
    expect(email.subject).toBe("New Submission for Advocacy: Commission <b>Meeting</b>");
    expect(email.text).toContain(`${ORIGIN}/admin/events/${submitted.id}`);
    expect(email.text).toContain(`${ORIGIN}/admin/review`);
    expect(email.text).toContain("Every week on Tuesday");
    expect(email.html).toContain("Commission &lt;b&gt;Meeting&lt;/b&gt;");
  });

  it("sends nothing when there is no active Editor", async () => {
    const transport = captureTransport();
    await notifyNewSubmission(db, transport, submitted, ORIGIN);
    expect(transport.sent).toHaveLength(0);
  });

  it("a send error is logged with its class only and never thrown", async () => {
    await addEditor(db, "Erin Editor");
    const log = vi.fn();
    const failing: EmailTransport = {
      kind: "resend",
      send: async () => {
        throw new TypeError("network to sam@example.org failed");
      },
    };
    await expect(notifyNewSubmission(db, failing, submitted, ORIGIN, log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[email] new-submission failed: TypeError");
  });
});

describe("Submitter emails", () => {
  const review = {
    id: submitted.id,
    calendar: "rides" as const,
    title: "Social Ride",
    submitterEmail: "sam@example.org",
    rule: { eventId: submitted.id, ...draft().rule },
  };

  it("approve links to the next date of the Event", async () => {
    const transport = captureTransport();
    await notifyApproved(transport, review, ORIGIN, "2026-10-10");
    expect(transport.sent[0].to).toEqual(["sam@example.org"]);
    expect(transport.sent[0].text).toContain(`${ORIGIN}/events/${submitted.id}/2026-10-13T1800`);
  });

  it("approve of an Event with no future date links to its Calendar page", async () => {
    const transport = captureTransport();
    const past = { ...review, rule: { ...review.rule, rrule: null } };
    await notifyApproved(transport, past, ORIGIN, "2027-01-01");
    expect(transport.sent[0].text).toContain(`${ORIGIN}/rides`);
  });

  it("reject sends the reason", async () => {
    const transport = captureTransport();
    await notifyRejected(transport, review, "Not a bike event.");
    expect(transport.sent[0].to).toEqual(["sam@example.org"]);
    expect(transport.sent[0].text).toContain("Reason: Not a bike event.");
  });

  it("an Event with no Submitter email sends nothing", async () => {
    const transport = captureTransport();
    await notifyApproved(transport, { ...review, submitterEmail: null }, ORIGIN, "2026-10-10");
    await notifyRejected(transport, { ...review, submitterEmail: null }, null);
    expect(transport.sent).toHaveLength(0);
  });
});
