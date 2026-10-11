import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEvent } from "@/admin/events/create-event";
import { editPendingEvent } from "@/admin/events/edit-event";
import { saveOverride } from "@/admin/events/overrides";
import { loadHistory } from "@/admin/events/queries";
import { splitSeries } from "@/admin/events/split-series";
import { addEditor, addTag, draft, eventRow, historyOf, tagIdsOfEvent } from "@/admin/events/test-helpers";
import type { Actor } from "@/admin/events/write-helpers";
import { loadSnapshot } from "@/agenda/snapshot";
import { events } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { countPending, listReviewQueue } from "./queue";
import {
  approveSubmission,
  deleteSubmissionAsSpam,
  imageRemovedByReview,
  parseRejectReason,
  rejectSubmission,
} from "./review";
import { submitEvent, type SubmitDeps } from "./submit-event";
import type { SubmissionValues } from "./submission-input";

const TODAY = "2026-10-10";
const IMAGE = `https://store.public.blob.vercel-storage.com/events/${"b".repeat(64)}.webp`;

const deps: SubmitDeps = {
  today: TODAY,
  hitRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  verifyTurnstile: async () => "passed",
  storeImage: async () => ({ ok: true, url: IMAGE, width: 1, height: 1 }),
};

describe("Review queue and review writes", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
  });
  afterEach(async () => close());

  async function submit(patch: Partial<SubmissionValues> = {}, image = false): Promise<string> {
    const values: SubmissionValues = {
      calendar: "rides",
      title: "Social Ride",
      description: "",
      location: "",
      tagIds: [],
      ctaLabel: "",
      ctaUrl: "",
      allDay: false,
      start: "2026-10-13T18:00",
      end: "2026-10-13T20:00",
      repeats: true,
      repeatDays: ["TU"],
      repeatUntil: "2026-12-29",
      submitterName: "Sam Rider",
      submitterEmail: "sam@example.org",
      ...patch,
    };
    const result = await submitEvent(
      db,
      { values, honeypot: "", turnstileToken: "t", ip: "203.0.113.9", image: image ? new Uint8Array([1]) : null },
      deps,
    );
    if (!result.ok || !result.event) throw new Error("not saved");
    return result.event.id;
  }

  describe("queue", () => {
    it("lists pending, not deleted Events of both Calendars, oldest first, and filters by Calendar", async () => {
      const first = await submit({ title: "First" });
      const second = await submit({ title: "Meeting", calendar: "advocacy", repeats: false });
      const gone = await submit({ title: "Spam" });
      await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, gone));
      const approved = await createEvent(db, erin, draft({ title: "Editor ride" }));
      expect(approved.ok).toBe(true);
      await db.update(events).set({ createdAt: new Date("2026-10-01T12:00:00Z") }).where(eq(events.id, second));

      const all = await listReviewQueue(db, { calendar: null });
      expect(all.map((r) => r.title)).toEqual(["Meeting", "First"]);
      expect(all[1]).toMatchObject({
        id: first,
        calendar: "rides",
        submitterName: "Sam Rider",
        repeat: "Every week on Tuesday, until December 29, 2026",
        when: "Tue, Oct 13, 6:00 pm",
      });
      expect((await listReviewQueue(db, { calendar: "advocacy" })).map((r) => r.title)).toEqual(["Meeting"]);
      expect(await countPending(db)).toBe(2);
    });
  });

  describe("approve", () => {
    it("sets approved, reviewed_by, reviewed_at, version + 1, writes approve, and the Event is public", async () => {
      const id = await submit();
      const result = await approveSubmission(db, erin, { id, version: 1 });
      expect(result).toMatchObject({ ok: true, review: { id, calendar: "rides", title: "Social Ride", submitterEmail: "sam@example.org" } });
      const row = await eventRow(db, id);
      expect(row).toMatchObject({ reviewStatus: "approved", reviewedBy: erin.id, updatedBy: erin.id, version: 2 });
      expect(row.reviewedAt).not.toBeNull();
      expect((await historyOf(db, id)).map((h) => [h.action, h.changedBy])).toEqual([
        ["submit", null],
        ["approve", erin.id],
      ]);
      expect((await loadSnapshot(db, "rides")).events.map((e) => e.id)).toEqual([id]);
    });

    it("a stale version gives the conflict message and changes nothing", async () => {
      const id = await submit();
      await approveSubmission(db, erin, { id, version: 1 });
      const again = await approveSubmission(db, erin, { id, version: 1 });
      expect(again).toMatchObject({ ok: false, reason: "conflict", message: expect.stringMatching(/Another Editor/) });
      expect((await historyOf(db, id))).toHaveLength(2);
    });

    it("an approved Event cannot be approved again", async () => {
      const id = await submit();
      await approveSubmission(db, erin, { id, version: 1 });
      expect(await approveSubmission(db, erin, { id, version: 2 })).toMatchObject({
        ok: false,
        reason: "invalid",
        message: "This Event is already approved.",
      });
    });

    it("a rejected Event can be approved (undo a Reject)", async () => {
      const id = await submit();
      await rejectSubmission(db, erin, { id, version: 1 }, null);
      expect((await approveSubmission(db, erin, { id, version: 2 })).ok).toBe(true);
      expect((await eventRow(db, id)).reviewStatus).toBe("approved");
    });

    it("a deleted Submission cannot be approved", async () => {
      const id = await submit();
      await deleteSubmissionAsSpam(db, erin, { id, version: 1 });
      expect(await approveSubmission(db, erin, { id, version: 2 })).toMatchObject({ ok: false, reason: "deleted" });
    });
  });

  describe("reject", () => {
    it("sets rejected, reviewed_by, reviewed_at, and records the reason in the history", async () => {
      const id = await submit();
      const result = await rejectSubmission(db, erin, { id, version: 1 }, "Not a bike event.");
      expect(result).toMatchObject({ ok: true, review: { submitterEmail: "sam@example.org" }, orphanImageUrl: null });
      expect(await eventRow(db, id)).toMatchObject({ reviewStatus: "rejected", reviewedBy: erin.id, version: 2 });
      const history = await historyOf(db, id);
      expect(history.at(-1)).toMatchObject({ action: "reject", changedBy: erin.id, snapshot: { detail: { reason: "Not a bike event." } } });
      expect((await loadHistory(db, id)).map((h) => [h.who, h.what])).toEqual([
        ["Erin Editor", "Rejected: Not a bike event."],
        ["Submitter", "Submitted"],
      ]);
      expect((await loadSnapshot(db, null)).events).toHaveLength(0);
    });

    it("only a pending Event can be rejected", async () => {
      const id = await submit();
      await approveSubmission(db, erin, { id, version: 1 });
      expect(await rejectSubmission(db, erin, { id, version: 2 }, null)).toMatchObject({ ok: false, reason: "invalid" });
    });

    it("an image that no other Event uses is cleared and given back for removal", async () => {
      const id = await submit({}, true);
      const result = await rejectSubmission(db, erin, { id, version: 1 }, null);
      expect(result).toMatchObject({ ok: true, orphanImageUrl: IMAGE });
      expect((await eventRow(db, id)).imageUrl).toBeNull();
      expect((await historyOf(db, id)).at(-1)?.snapshot).toMatchObject({ detail: { imageRemoved: true } });
      expect(await imageRemovedByReview(db, id)).toBe(true);
    });

    it("a Reject with no image, or an image that stays, does not say that the image was removed", async () => {
      const plain = await submit();
      await rejectSubmission(db, erin, { id: plain, version: 1 }, null);
      expect(await imageRemovedByReview(db, plain)).toBe(false);
      const shared = await submit({}, true);
      await createEvent(db, erin, draft({ imageUrl: IMAGE }));
      await rejectSubmission(db, erin, { id: shared, version: 1 }, null);
      expect(await imageRemovedByReview(db, shared)).toBe(false);
    });

    it("after an image is added again, the note goes away", async () => {
      const id = await submit({}, true);
      await rejectSubmission(db, erin, { id, version: 1 }, null);
      await db.update(events).set({ imageUrl: IMAGE }).where(eq(events.id, id));
      expect(await imageRemovedByReview(db, id)).toBe(false);
    });

    it("an image that another Event also uses stays", async () => {
      const id = await submit({}, true);
      await createEvent(db, erin, draft({ imageUrl: IMAGE }));
      const result = await rejectSubmission(db, erin, { id, version: 1 }, null);
      expect(result).toMatchObject({ ok: true, orphanImageUrl: null });
      expect((await eventRow(db, id)).imageUrl).toBe(IMAGE);
    });

    it("the reason is optional and at most 500 characters", () => {
      expect(parseRejectReason(undefined)).toEqual({ ok: true, value: null });
      expect(parseRejectReason("  ")).toEqual({ ok: true, value: null });
      expect(parseRejectReason(" Too far away. ")).toEqual({ ok: true, value: "Too far away." });
      expect(parseRejectReason("x".repeat(501))).toMatchObject({ ok: false });
    });
  });

  describe("delete as spam", () => {
    it("soft-deletes a pending Event with a delete history row and gives back an orphan image", async () => {
      const id = await submit({}, true);
      const result = await deleteSubmissionAsSpam(db, erin, { id, version: 1 });
      expect(result).toMatchObject({ ok: true, orphanImageUrl: IMAGE });
      const row = await eventRow(db, id);
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(erin.id);
      expect((await historyOf(db, id)).at(-1)?.action).toBe("delete");
      expect(await countPending(db)).toBe(0);
    });

    it("an approved Event is not deleted as spam", async () => {
      const id = await submit();
      await approveSubmission(db, erin, { id, version: 1 });
      expect(await deleteSubmissionAsSpam(db, erin, { id, version: 2 })).toMatchObject({ ok: false, reason: "invalid" });
    });
  });

  describe("edit before approval", () => {
    it("a pending Series changes its Calendar, time, and rule in place, with an edit history row", async () => {
      const id = await submit({ tagIds: [await addTag(db, "rides", "social")] });
      const meeting = await addTag(db, "advocacy", "meeting");
      const result = await editPendingEvent(db, erin, { id, version: 1 }, draft({
        calendar: "advocacy",
        title: "Social Ride (edited)",
        tagIds: [meeting],
        rule: {
          timing: { kind: "timed", start: "2026-10-15T18:30", end: "2026-10-15T20:30" },
          rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=10,11;UNTIL=20261126T235959",
          exdates: [],
          scheduleStatus: "scheduled",
          scheduleNote: null,
        },
      }));
      expect(result.ok).toBe(true);
      expect(await eventRow(db, id)).toMatchObject({
        calendar: "advocacy",
        title: "Social Ride (edited)",
        startLocal: "2026-10-15T18:30",
        rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=10,11;UNTIL=20261126T235959",
        reviewStatus: "pending",
        submitterEmail: "sam@example.org",
        version: 2,
      });
      expect(await tagIdsOfEvent(db, id)).toEqual([meeting]);
      expect((await historyOf(db, id)).map((h) => h.action)).toEqual(["submit", "edit"]);
    });

    it("an approved Event is not edited this way", async () => {
      const id = await submit();
      await approveSubmission(db, erin, { id, version: 1 });
      expect(await editPendingEvent(db, erin, { id, version: 2 }, draft())).toMatchObject({ ok: false, reason: "invalid" });
    });

    it("a Series split and a change to one date are refused while the Event is pending", async () => {
      const id = await submit();
      const split = await splitSeries(
        db,
        erin,
        { id, version: 1 },
        {
          ...draft(),
          splitDate: "2026-11-03",
          mode: "stop",
          time: { kind: "timed", startTime: "18:00", endTime: "20:00" },
          rule: { kind: "same" },
        },
        { today: TODAY },
      );
      expect(split).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/Submission/) });
      const override = await saveOverride(db, erin, { id, version: 1 }, {
        originalStart: "2026-10-20T18:00",
        timing: { kind: "timed", start: "2026-10-20T18:00", end: "2026-10-20T20:00" },
        title: "Social Ride",
        location: null,
        scheduleStatus: "cancelled",
        scheduleNote: null,
        occurrenceDetails: null,
      });
      expect(override).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/Submission/) });
    });
  });
});
