/** Each successful Tag change clears the public cache (`public-events`). Writes are mocked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidatePublicEvents: vi.fn(),
  result: { ok: true, value: { name: "Social", slug: "social", moved: 0, duplicates: 0 } } as Record<string, unknown>,
}));

vi.mock("@/agenda/cache", () => ({ invalidatePublicEvents: mocks.invalidatePublicEvents }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/auth/dal", () => ({ requireEditor: async () => ({ id: "e1", role: "editor" }) }));
vi.mock("@/admin/tags/tags", () => {
  const write = async () => mocks.result;
  return { addTag: write, renameTag: write, retireTag: write, unretireTag: write, mergeTags: write };
});

import { addTagAction, tagRowAction } from "./actions";

const idle = { result: "idle" } as const;
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("Tag actions clear the public cache", () => {
  beforeEach(() => {
    mocks.invalidatePublicEvents.mockClear();
    mocks.result = { ok: true, value: { name: "Social", slug: "social", moved: 0, duplicates: 0 } };
  });

  it("add clears the public-events tag", async () => {
    await addTagAction(idle, form({ calendar: "rides", name: "Social" }));
    expect(mocks.invalidatePublicEvents).toHaveBeenCalledTimes(1);
  });

  for (const intent of ["rename", "retire", "unretire", "merge"]) {
    it(`${intent} clears the public-events tag`, async () => {
      await tagRowAction(idle, form({ intent, tagId: "t1", name: "Social", targetId: "t2" }));
      expect(mocks.invalidatePublicEvents).toHaveBeenCalledTimes(1);
    });
  }

  it("a refused Tag change does not clear the cache", async () => {
    mocks.result = { ok: false, error: "This Tag is already retired." };
    await tagRowAction(idle, form({ intent: "retire", tagId: "t1" }));
    expect(mocks.invalidatePublicEvents).not.toHaveBeenCalled();
  });
});
