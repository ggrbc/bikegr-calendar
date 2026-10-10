/**
 * Each Event write clears the public cache (`public-events`), so the agenda, the Embed, and the
 * Feeds show the change at once. The write modules are mocked; their own tests cover the writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidatePublicEvents: vi.fn(),
  ok: { ok: true, id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", kind: "change" } as Record<string, unknown>,
  after: vi.fn(),
  notifyApproved: vi.fn(async () => {}),
  notifyRejected: vi.fn(async () => {}),
}));

const review = { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", calendar: "rides", title: "Ride", submitterEmail: "s@x.org" };

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/email/transport", () => ({ createEmailTransport: () => ({ kind: "capture", send: async () => {} }) }));
vi.mock("@/email/notify", () => ({
  appOrigin: () => "http://localhost:3000",
  notifyApproved: mocks.notifyApproved,
  notifyRejected: mocks.notifyRejected,
}));
vi.mock("@/submissions/review", () => ({
  approveSubmission: async () => ({ ...mocks.ok, review }),
  rejectSubmission: async () => ({ ...mocks.ok, review, orphanImageUrl: null }),
  deleteSubmissionAsSpam: async () => ({ ...mocks.ok, orphanImageUrl: null }),
  parseRejectReason: (value: unknown) =>
    typeof value === "string" && value.length > 500 ? { ok: false, errors: { reason: "too long" } } : { ok: true, value: value ?? null },
}));

vi.mock("@/agenda/cache", () => ({ invalidatePublicEvents: mocks.invalidatePublicEvents }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/auth/dal", () => {
  const editor = { id: "e1", role: "admin", email: "a@bikegr.org", name: "A" };
  return { requireEditor: async () => editor, requireAdmin: async () => editor };
});
vi.mock("@/admin/events/queries", () => ({
  loadEventForEdit: async () => ({ row: { imageUrl: null, allDay: false } }),
}));
vi.mock("@/admin/events/event-input", () => {
  const parsed = () => ({ ok: true, value: {} });
  return {
    parseEventInput: parsed,
    parseOverrideInput: parsed,
    parseSeriesContentInput: parsed,
    parseSplitInput: parsed,
  };
});
vi.mock("@/admin/events/create-event", () => ({ createEvent: async () => mocks.ok }));
vi.mock("@/admin/events/delete-event", () => ({
  deleteEvent: async () => mocks.ok,
  restoreEvent: async () => mocks.ok,
}));
vi.mock("@/admin/events/edit-event", () => ({
  editOneTimeEvent: async () => mocks.ok,
  editPendingEvent: async () => mocks.ok,
  editSeriesContent: async () => mocks.ok,
}));
vi.mock("@/admin/events/overrides", () => ({
  saveOverride: async () => mocks.ok,
  clearOverride: async () => mocks.ok,
}));
vi.mock("@/admin/events/split-series", () => ({ splitSeries: async () => mocks.ok }));

import {
  approveSubmissionAction,
  clearOverrideAction,
  deleteSubmissionAsSpamAction,
  rejectSubmissionAction,
  createEventAction,
  deleteEventAction,
  restoreEventAction,
  saveEventAction,
  saveOverrideAction,
  splitSeriesAction,
} from "./actions";

const idle = { status: "idle" } as const;
const target = { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", version: 1, values: {} };

describe("Event write actions clear the public cache", () => {
  beforeEach(() => {
    mocks.invalidatePublicEvents.mockClear();
    mocks.after.mockClear();
    mocks.ok = { ok: true, id: target.id, kind: "change" };
  });

  const actions: [string, () => Promise<unknown>][] = [
    ["create", () => createEventAction(idle, { values: {} })],
    ["save, scope all", () => saveEventAction(idle, { ...target, scope: "all" })],
    ["save, one-time", () => saveEventAction(idle, { ...target, scope: "one-time" })],
    ["Series split or stop", () => splitSeriesAction(idle, target)],
    ["save Override", () => saveOverrideAction(idle, target)],
    ["clear Override", () => clearOverrideAction(idle, { ...target, originalStart: "2026-10-14T18:00" })],
    ["delete", () => deleteEventAction(idle, target)],
    ["restore", () => restoreEventAction(idle, target)],
    ["save, pending", () => saveEventAction(idle, { ...target, scope: "pending" })],
    ["approve", () => approveSubmissionAction(idle, target)],
    ["reject", () => rejectSubmissionAction(idle, { ...target, reason: "Not a bike event." })],
    ["delete as spam", () => deleteSubmissionAsSpamAction(idle, target)],
  ];

  for (const [name, run] of actions) {
    it(`${name} clears the public-events tag once`, async () => {
      await run();
      expect(mocks.invalidatePublicEvents).toHaveBeenCalledTimes(1);
    });
  }

  it("a failed write does not clear the cache", async () => {
    mocks.ok = { ok: false, reason: "conflict", message: "Someone else saved first." };
    await deleteEventAction(idle, target);
    expect(mocks.invalidatePublicEvents).not.toHaveBeenCalled();
  });
});

describe("Review actions", () => {
  beforeEach(() => {
    mocks.ok = { ok: true };
    mocks.after.mockClear();
    mocks.notifyApproved.mockClear();
    mocks.notifyRejected.mockClear();
    mocks.invalidatePublicEvents.mockClear();
  });

  it("approve sends the Submitter email after the response", async () => {
    const state = await approveSubmissionAction(idle, target);
    expect(state).toMatchObject({ status: "saved", message: expect.stringMatching(/Approved/) });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.notifyApproved).toHaveBeenCalledOnce();
  });

  it("reject sends the reason in the email after the response", async () => {
    await rejectSubmissionAction(idle, { ...target, reason: "Not a bike event." });
    await mocks.after.mock.calls[0][0]();
    expect(mocks.notifyRejected).toHaveBeenCalledWith(expect.anything(), review, "Not a bike event.");
  });

  it("a reject reason over the limit is refused before the write", async () => {
    const state = await rejectSubmissionAction(idle, { ...target, reason: "x".repeat(501) });
    expect(state).toMatchObject({ status: "invalid", errors: { reason: "too long" } });
    expect(mocks.invalidatePublicEvents).not.toHaveBeenCalled();
  });

  it("delete as spam sends no email", async () => {
    await deleteSubmissionAsSpamAction(idle, target);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
    expect(mocks.notifyRejected).not.toHaveBeenCalled();
  });
});
