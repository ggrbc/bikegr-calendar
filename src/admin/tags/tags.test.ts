import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editors, eventTags, events, tags } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";
import {
  addTag,
  listPickerTags,
  listTagsForAdmin,
  mergeTags,
  renameTag,
  retireTag,
  unretireTag,
} from "./tags";

describe("Tag management", () => {
  let db: Db;
  let close: () => Promise<void>;
  let editorId: string;
  let otherEditorId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const [a, b] = await db
      .insert(editors)
      .values([
        { email: "ed@example.org", role: "editor" },
        { email: "other@example.org", role: "editor" },
      ])
      .returning();
    editorId = a.id;
    otherEditorId = b.id;
  });
  afterAll(async () => close());

  async function tag(calendar: CalendarSlug, name: string, patch: Partial<typeof tags.$inferInsert> = {}) {
    const result = await addTag(db, otherEditorId, { calendar, name });
    if (!result.ok) throw new Error(result.error);
    if (Object.keys(patch).length === 0) return result.value;
    const [row] = await db.update(tags).set(patch).where(eq(tags.id, result.value.id)).returning();
    return row;
  }

  async function event(calendar: CalendarSlug, title: string, patch: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({ calendar, title, allDay: true, startDate: "2026-11-01", endDate: "2026-11-01", ...patch })
      .returning();
    return row;
  }

  async function link(eventRow: { id: string; calendar: CalendarSlug }, ...tagRows: { id: string }[]) {
    await db
      .insert(eventTags)
      .values(tagRows.map((t) => ({ eventId: eventRow.id, tagId: t.id, calendar: eventRow.calendar })));
  }

  async function tagIdsOf(eventId: string) {
    const rows = await db.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, eventId));
    return rows.map((r) => r.tagId).sort();
  }

  async function reload(id: string) {
    const [row] = await db.select().from(tags).where(eq(tags.id, id));
    return row;
  }

  describe("add", () => {
    it("Add creates a Tag with its slug, created_by, and updated_by", async () => {
      const result = await addTag(db, editorId, { calendar: "rides", name: "  Non   Drop " });
      expect(result).toMatchObject({
        ok: true,
        value: {
          calendar: "rides",
          name: "Non Drop",
          slug: "non-drop",
          createdBy: editorId,
          updatedBy: editorId,
          retiredAt: null,
        },
      });
    });

    it("Add refuses an invalid name", async () => {
      const result = await addTag(db, editorId, { calendar: "rides", name: "!!" });
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
    });

    it("Add refuses a duplicate slug in the same Calendar", async () => {
      await tag("rides", "Gravel");
      const result = await addTag(db, editorId, { calendar: "rides", name: "GRAVEL!" });
      expect(result).toMatchObject({ ok: false, reason: "duplicate-slug" });
      if (!result.ok) expect(result.error).toContain("Gravel");
    });

    it("Add refuses a duplicate slug of a retired Tag and says to unretire it", async () => {
      await tag("rides", "Old Name", { retiredAt: new Date() });
      const result = await addTag(db, editorId, { calendar: "rides", name: "old name" });
      expect(result).toMatchObject({ ok: false, reason: "duplicate-slug" });
      if (!result.ok) expect(result.error).toContain("Unretire it instead");
    });

    it("Add allows the same slug in the other Calendar", async () => {
      await tag("rides", "Family");
      const result = await addTag(db, editorId, { calendar: "advocacy", name: "Family" });
      expect(result).toMatchObject({ ok: true, value: { calendar: "advocacy", slug: "family" } });
    });
  });

  describe("rename", () => {
    it("Rename changes the name and keeps the slug", async () => {
      const t = await tag("rides", "Group Ride");
      const result = await renameTag(db, editorId, { tagId: t.id, name: "Group Rides (all paces)" });
      expect(result).toMatchObject({ ok: true, value: { name: "Group Rides (all paces)", slug: "group-ride" } });
      const row = await reload(t.id);
      expect(row.slug).toBe("group-ride");
      expect(row.updatedBy).toBe(editorId);
    });

    it("Rename refuses a name that another active Tag of that Calendar has", async () => {
      await tag("rides", "Race");
      const t = await tag("rides", "Racing");
      const result = await renameTag(db, editorId, { tagId: t.id, name: "race" });
      expect(result).toMatchObject({ ok: false, reason: "duplicate-name" });
      expect((await reload(t.id)).name).toBe("Racing");
    });

    it("Rename allows a name that only a Tag of the other Calendar has", async () => {
      await tag("advocacy", "Hearing");
      const t = await tag("rides", "Hearings");
      const result = await renameTag(db, editorId, { tagId: t.id, name: "Hearing" });
      expect(result).toMatchObject({ ok: true, value: { name: "Hearing", slug: "hearings" } });
    });

    it("Rename allows a name that only a retired Tag has", async () => {
      await tag("rides", "Night", { retiredAt: new Date() });
      const t = await tag("rides", "Night Ride");
      const result = await renameTag(db, editorId, { tagId: t.id, name: "Night" });
      expect(result).toMatchObject({ ok: true });
    });

    it("Rename of a missing Tag is refused", async () => {
      expect(await renameTag(db, editorId, { tagId: crypto.randomUUID(), name: "X" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(await renameTag(db, editorId, { tagId: "not-a-uuid", name: "X" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("retire and unretire", () => {
    it("Retire keeps the Event links and sets retired_at and retired_by", async () => {
      const t = await tag("rides", "Retire Me");
      const e = await event("rides", "Linked");
      await link(e, t);
      const result = await retireTag(db, editorId, { tagId: t.id });
      expect(result).toMatchObject({ ok: true });
      const row = await reload(t.id);
      expect(row.retiredAt).toBeInstanceOf(Date);
      expect(row.retiredBy).toBe(editorId);
      expect(row.updatedBy).toBe(editorId);
      expect(await tagIdsOf(e.id)).toEqual([t.id]);
    });

    it("Retire of a retired Tag is refused as already retired", async () => {
      const t = await tag("rides", "Twice Retired", { retiredAt: new Date() });
      expect(await retireTag(db, editorId, { tagId: t.id })).toMatchObject({
        ok: false,
        reason: "already-retired",
      });
    });

    it("Unretire clears retired_at and retired_by", async () => {
      const t = await tag("rides", "Come Back", { retiredAt: new Date(), retiredBy: otherEditorId });
      expect(await unretireTag(db, editorId, { tagId: t.id })).toMatchObject({ ok: true });
      const row = await reload(t.id);
      expect(row.retiredAt).toBeNull();
      expect(row.retiredBy).toBeNull();
      expect(row.updatedBy).toBe(editorId);
    });

    it("Unretire of an active Tag is refused", async () => {
      const t = await tag("rides", "Still Active");
      expect(await unretireTag(db, editorId, { tagId: t.id })).toMatchObject({ ok: false, reason: "not-retired" });
    });

    it("Retire of a missing Tag is refused", async () => {
      expect(await retireTag(db, editorId, { tagId: crypto.randomUUID() })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("lists", () => {
    it("Picker list has only active Tags of the one Calendar, sorted by name", async () => {
      const { db: fresh, close: closeFresh } = await createTestDb();
      try {
        await fresh.insert(tags).values([
          { calendar: "rides", name: "Zebra", slug: "zebra" },
          { calendar: "rides", name: "apple", slug: "apple" },
          { calendar: "rides", name: "Gone", slug: "gone", retiredAt: new Date() },
          { calendar: "advocacy", name: "Budget", slug: "budget" },
        ]);
        const picker = await listPickerTags(fresh, "rides");
        expect(picker.map((t) => t.name)).toEqual(["apple", "Zebra"]);
        expect(Object.keys(picker[0]).sort()).toEqual(["id", "name", "slug"]);
      } finally {
        await closeFresh();
      }
    });

    it("Admin list counts Events per Tag and does not count deleted Events", async () => {
      const { db: fresh, close: closeFresh } = await createTestDb();
      try {
        const [used, unused, retired] = await fresh
          .insert(tags)
          .values([
            { calendar: "rides", name: "Used", slug: "used" },
            { calendar: "rides", name: "Unused", slug: "unused" },
            { calendar: "rides", name: "Retired", slug: "retired", retiredAt: new Date() },
          ])
          .returning();
        const rows = await fresh
          .insert(events)
          .values(
            ["One", "Two", "Deleted"].map((title) => ({
              calendar: "rides" as const,
              title,
              allDay: true,
              startDate: "2026-11-01",
              endDate: "2026-11-01",
              deletedAt: title === "Deleted" ? new Date() : null,
            })),
          )
          .returning();
        await fresh.insert(eventTags).values([
          ...rows.map((e) => ({ eventId: e.id, tagId: used.id, calendar: "rides" as const })),
          { eventId: rows[0].id, tagId: retired.id, calendar: "rides" as const },
        ]);
        const list = await listTagsForAdmin(fresh, "rides");
        expect(list.map((t) => [t.name, t.eventCount, t.retiredAt !== null])).toEqual([
          ["Unused", 0, false],
          ["Used", 2, false],
          ["Retired", 1, true],
        ]);
        expect(list.find((t) => t.id === unused.id)?.slug).toBe("unused");
      } finally {
        await closeFresh();
      }
    });
  });

  describe("merge", () => {
    it("Merge moves every link of A to B and retires A", async () => {
      const a = await tag("rides", "Merge A1");
      const b = await tag("rides", "Merge B1");
      const e1 = await event("rides", "E1");
      const e2 = await event("rides", "E2");
      await link(e1, a);
      await link(e2, a);
      const result = await mergeTags(db, editorId, { sourceId: a.id, targetId: b.id });
      expect(result).toEqual({ ok: true, value: { moved: 2, duplicates: 0 } });
      expect(await tagIdsOf(e1.id)).toEqual([b.id]);
      expect(await tagIdsOf(e2.id)).toEqual([b.id]);
      const source = await reload(a.id);
      expect(source.retiredAt).toBeInstanceOf(Date);
      expect(source.retiredBy).toBe(editorId);
      expect(source.updatedBy).toBe(editorId);
      expect((await reload(b.id)).retiredAt).toBeNull();
    });

    it("Merge of an Event that has both A and B leaves one B link", async () => {
      const a = await tag("rides", "Merge A2");
      const b = await tag("rides", "Merge B2");
      const both = await event("rides", "Both");
      await link(both, a, b);
      const result = await mergeTags(db, editorId, { sourceId: a.id, targetId: b.id });
      expect(result).toEqual({ ok: true, value: { moved: 0, duplicates: 1 } });
      expect(await tagIdsOf(both.id)).toEqual([b.id]);
    });

    it("Merge refuses A and B of different Calendars and changes nothing", async () => {
      const a = await tag("rides", "Merge A3");
      const b = await tag("advocacy", "Merge B3");
      const e = await event("rides", "E3");
      await link(e, a);
      const result = await mergeTags(db, editorId, { sourceId: a.id, targetId: b.id });
      expect(result).toMatchObject({ ok: false, reason: "other-calendar" });
      expect(await tagIdsOf(e.id)).toEqual([a.id]);
      expect((await reload(a.id)).retiredAt).toBeNull();
    });

    it("Merge refuses a retired target", async () => {
      const a = await tag("rides", "Merge A4");
      const b = await tag("rides", "Merge B4", { retiredAt: new Date() });
      const result = await mergeTags(db, editorId, { sourceId: a.id, targetId: b.id });
      expect(result).toMatchObject({ ok: false, reason: "retired-target" });
      expect((await reload(a.id)).retiredAt).toBeNull();
    });

    it("Merge of a retired source works and keeps its retired date", async () => {
      const retiredAt = new Date("2026-01-01T00:00:00Z");
      const a = await tag("rides", "Merge A5", { retiredAt, retiredBy: otherEditorId });
      const b = await tag("rides", "Merge B5");
      const e = await event("rides", "E5");
      await link(e, a);
      const result = await mergeTags(db, editorId, { sourceId: a.id, targetId: b.id });
      expect(result).toEqual({ ok: true, value: { moved: 1, duplicates: 0 } });
      expect(await tagIdsOf(e.id)).toEqual([b.id]);
      const source = await reload(a.id);
      expect(source.retiredAt).toEqual(retiredAt);
      expect(source.retiredBy).toBe(otherEditorId);
    });

    it("Merge of a Tag into itself is refused", async () => {
      const a = await tag("rides", "Merge A6");
      expect(await mergeTags(db, editorId, { sourceId: a.id, targetId: a.id })).toMatchObject({
        ok: false,
        reason: "same-tag",
      });
    });

    it("Merge of a missing Tag is refused", async () => {
      const a = await tag("rides", "Merge A7");
      expect(
        await mergeTags(db, editorId, { sourceId: a.id, targetId: crypto.randomUUID() }),
      ).toMatchObject({ ok: false, reason: "not-found" });
      expect(await mergeTags(db, editorId, { sourceId: "bad", targetId: a.id })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  it("Database refuses an Event-Tag link to a Tag of the other Calendar (composite FK)", async () => {
    const advocacyTag = await tag("advocacy", "Cross Calendar");
    const ridesEvent = await event("rides", "Rides only");
    // The link row says "rides" (the Event's Calendar): the Tag FK (tag_id, calendar) has no match.
    await expect(
      db.insert(eventTags).values({ eventId: ridesEvent.id, tagId: advocacyTag.id, calendar: "rides" }),
    ).rejects.toThrow();
    // The link row says "advocacy" (the Tag's Calendar): the Event FK (event_id, calendar) has no match.
    await expect(
      db.insert(eventTags).values({ eventId: ridesEvent.id, tagId: advocacyTag.id, calendar: "advocacy" }),
    ).rejects.toThrow();
    const rows = await db
      .select()
      .from(eventTags)
      .where(and(eq(eventTags.eventId, ridesEvent.id), eq(eventTags.tagId, advocacyTag.id)));
    expect(rows).toHaveLength(0);
  });
});
