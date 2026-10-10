import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { addEditor, addTag, draft, eventRow, historyOf, rowCounts, tagIdsOfEvent } from "./test-helpers";
import type { Actor } from "./write-helpers";

describe("create an Event", () => {
  let db: Db;
  let close: () => Promise<void>;
  let editor: Actor;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    editor = await addEditor(db, "Erin Editor");
  });
  afterEach(async () => close());

  it("makes an approved Event with created_by, its Tags, version 1, and one create history row", async () => {
    const tag = await addTag(db, "rides", "non-drop");
    const result = await createEvent(db, editor, draft({ tagIds: [tag], cta: { label: "Register", url: "https://example.org" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await eventRow(db, result.id);
    expect(row).toMatchObject({
      reviewStatus: "approved",
      createdBy: editor.id,
      updatedBy: editor.id,
      reviewedBy: editor.id,
      version: 1,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      startLocal: "2026-10-06T18:00",
      ctaLabel: "Register",
      sourceId: null,
    });
    expect(row.reviewedAt).not.toBeNull();
    expect(await tagIdsOfEvent(db, result.id)).toEqual([tag]);
    const history = await historyOf(db, result.id);
    expect(history.map((h) => [h.action, h.version, h.changedBy])).toEqual([["create", 1, editor.id]]);
    expect(history[0].snapshot).toMatchObject({ tagSlugs: ["non-drop"], overrides: [] });
  });

  it("refuses a Tag of the other Calendar and a retired Tag; nothing is written", async () => {
    const other = await addTag(db, "advocacy", "meeting");
    const retired = await addTag(db, "rides", "old", true);
    expect(await createEvent(db, editor, draft({ tagIds: [other] }))).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { tags: "Pick Tags from the list." },
    });
    expect(await createEvent(db, editor, draft({ tagIds: [retired] }))).toMatchObject({
      ok: false,
      errors: { tags: "This Tag was retired. Pick another one." },
    });
    expect(await rowCounts(db)).toEqual({ events: 0, overrides: 0, eventTags: 0, history: 0 });
  });
});
