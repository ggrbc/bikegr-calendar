/**
 * Each Event write clears the public cache (`public-events`), so the agenda, the Embed, and the
 * Feeds show the change at once. The write modules are mocked; their own tests cover the writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidatePublicEvents: vi.fn(),
  ok: { ok: true, id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", kind: "change" } as Record<string, unknown>,
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
  editSeriesContent: async () => mocks.ok,
}));
vi.mock("@/admin/events/overrides", () => ({
  saveOverride: async () => mocks.ok,
  clearOverride: async () => mocks.ok,
}));
vi.mock("@/admin/events/split-series", () => ({ splitSeries: async () => mocks.ok }));

import {
  clearOverrideAction,
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
