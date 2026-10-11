import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTag, eventRow, historyOf, rowCounts, tagIdsOfEvent } from "@/admin/events/test-helpers";
import { loadSnapshot } from "@/agenda/snapshot";
import { findOccurrence } from "@/agenda/find-occurrence";
import { createTestDb } from "@/db/test-db";
import { hitRateLimit } from "@/rate-limit";
import type { Db } from "@/db/types";
import type { RateLimitRule } from "./spam-rules";
import { limitedMessage, MESSAGES, type SubmitDeps, submitEvent, type SubmitInput } from "./submit-event";
import type { SubmissionValues } from "./submission-input";

const TODAY = "2026-10-10";
const IMAGE_URL = `https://store.public.blob.vercel-storage.com/events/${"a".repeat(64)}.webp`;

function values(patch: Partial<SubmissionValues> = {}): SubmissionValues {
  return {
    calendar: "rides",
    title: "Tuesday Social Ride",
    description: "Meet at the shop.",
    preview: "",
    location: "Riverside Park",
    tagIds: [],
    ctaLabel: "",
    ctaUrl: "",
    allDay: false,
    start: "2026-10-13T18:00",
    end: "2026-10-13T20:00",
    repeats: true,
    repeatKind: "weekly",
    repeatDays: ["TU"],
    repeatUntil: "2026-12-29",
    submitterName: "Sam Rider",
    submitterEmail: "sam@example.org",
    ...patch,
  };
}

describe("submitEvent", () => {
  let db: Db;
  let close: () => Promise<void>;
  let hits: [RateLimitRule, string][];
  let deps: SubmitDeps & {
    hitRateLimit: ReturnType<typeof vi.fn>;
    verifyTurnstile: ReturnType<typeof vi.fn>;
    storeImage: ReturnType<typeof vi.fn>;
  };

  const input = (patch: Partial<SubmitInput> = {}): SubmitInput => ({
    values: values(),
    honeypot: "",
    turnstileToken: "token",
    ip: "203.0.113.9",
    image: null,
    ...patch,
  });

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    hits = [];
    deps = {
      today: TODAY,
      hitRateLimit: vi.fn(async (rule: RateLimitRule, key: string) => {
        hits.push([rule, key]);
        return { allowed: true, retryAfterSeconds: 0 };
      }),
      verifyTurnstile: vi.fn(async () => "passed" as const),
      storeImage: vi.fn(async () => ({ ok: true as const, url: IMAGE_URL, width: 800, height: 600 })),
      log: vi.fn(),
    };
  });
  afterEach(async () => close());

  it("makes a pending Event with no created_by, the Submitter fields, its Tags, version 1, and one submit history row", async () => {
    const tag = await addTag(db, "rides", "social");
    const result = await submitEvent(db, input({ values: values({ tagIds: [tag] }) }), deps);
    expect(result.ok && result.event).toBeTruthy();
    if (!result.ok || !result.event) return;
    const row = await eventRow(db, result.event.id);
    expect(row).toMatchObject({
      calendar: "rides",
      reviewStatus: "pending",
      createdBy: null,
      updatedBy: null,
      reviewedBy: null,
      reviewedAt: null,
      submitterName: "Sam Rider",
      submitterEmail: "sam@example.org",
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261229T235959",
      startLocal: "2026-10-13T18:00",
      version: 1,
      imageUrl: null,
    });
    expect(await tagIdsOfEvent(db, row.id)).toEqual([tag]);
    const history = await historyOf(db, row.id);
    expect(history.map((h) => [h.action, h.version, h.changedBy])).toEqual([["submit", 1, null]]);
    expect(history[0].snapshot).toMatchObject({ event: { title: "Tuesday Social Ride" }, tagSlugs: ["social"] });
  });

  it("a Submission is not public: not in the snapshot, and its detail URL is missing", async () => {
    const result = await submitEvent(db, input(), deps);
    if (!result.ok || !result.event) throw new Error("not saved");
    const snapshot = await loadSnapshot(db, "rides");
    expect(snapshot.events.map((e) => e.id)).not.toContain(result.event.id);
    const all = await loadSnapshot(db, null);
    expect(all.events).toHaveLength(0);
    expect((await findOccurrence(db, result.event.id, "2026-10-13T1800", { today: TODAY })).kind).toBe("missing");
  });

  it("counts per IP (an hour, a day) before Turnstile, and all Submissions only after a Turnstile pass", async () => {
    const order: string[] = [];
    deps.hitRateLimit.mockImplementation(async (rule: RateLimitRule, key: string) => {
      hits.push([rule, key]);
      order.push(rule.bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    });
    deps.verifyTurnstile.mockImplementation(async () => (order.push("turnstile"), "passed"));
    await submitEvent(db, input(), deps);
    expect(hits.map(([rule, key]) => [rule.bucket, rule.limit, rule.windowSeconds, key])).toEqual([
      ["submission-ip-hour", 3, 3600, "203.0.113.9"],
      ["submission-ip-day", 10, 86400, "203.0.113.9"],
      ["submission-all-day", 20, 86400, "all"],
    ]);
    expect(order).toEqual(["submission-ip-hour", "submission-ip-day", "turnstile", "submission-all-day"]);
  });

  it("a failed Turnstile check does not count against all Submissions", async () => {
    deps.verifyTurnstile.mockResolvedValue("refused");
    await submitEvent(db, input(), deps);
    expect(hits.map(([rule]) => rule.bucket)).toEqual(["submission-ip-hour", "submission-ip-day"]);
  });

  describe("with the real Postgres rate limit", () => {
    const realLimit = () => (rule: RateLimitRule, key: string) => hitRateLimit(db, rule, key);

    it("21 sends with no valid token from 7 IPs do not lock out a real Submitter", async () => {
      deps.hitRateLimit.mockImplementation(realLimit());
      deps.verifyTurnstile.mockImplementation(async (token: string) => (token === "valid" ? "passed" : "refused"));
      for (let i = 0; i < 21; i++) {
        const bot = await submitEvent(db, input({ ip: `198.51.100.${(i % 7) + 1}`, turnstileToken: "" }), deps);
        expect(bot).toMatchObject({ ok: false, reason: "turnstile" });
      }
      const real = await submitEvent(db, input({ ip: "203.0.113.50", turnstileToken: "valid" }), deps);
      expect(real.ok && real.event).toBeTruthy();
      expect((await rowCounts(db)).events).toBe(1);
    });

    it("20 Turnstile passes in one day are saved; the 21st is refused with Too many Submissions", async () => {
      deps.hitRateLimit.mockImplementation(realLimit());
      for (let i = 0; i < 20; i++) {
        const ok = await submitEvent(db, input({ ip: `192.0.2.${i + 1}` }), deps);
        expect(ok.ok && ok.event).toBeTruthy();
      }
      const refused = await submitEvent(db, input({ ip: "192.0.2.100" }), deps);
      expect(refused).toMatchObject({ ok: false, reason: "limited", message: expect.stringMatching(/^Too many Submissions/) });
      expect((await rowCounts(db)).events).toBe(20);
    });
  });

  it("a refused global limit writes nothing and runs no image work", async () => {
    deps.hitRateLimit.mockImplementation(async (rule: RateLimitRule) => ({
      allowed: rule.bucket !== "submission-all-day",
      retryAfterSeconds: 3600,
    }));
    const result = await submitEvent(db, input({ image: new Uint8Array([1, 2, 3]) }), deps);
    expect(result).toMatchObject({ ok: false, reason: "limited" });
    expect(deps.verifyTurnstile).toHaveBeenCalledOnce();
    expect(deps.storeImage).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a global-limit check that throws refuses the Submission (fail closed) and runs no image work", async () => {
    deps.hitRateLimit.mockImplementation(async (rule: RateLimitRule) => {
      if (rule.bucket === "submission-all-day") throw Object.assign(new Error("db down"), { code: "57P01" });
      return { allowed: true, retryAfterSeconds: 0 };
    });
    const result = await submitEvent(db, input({ image: new Uint8Array([1]) }), deps);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: MESSAGES.unavailable });
    expect(deps.log).toHaveBeenCalledWith("[submissions] Rate limit check failed: Error code=57P01");
    expect(deps.storeImage).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a request with no IP uses the shared unknown key", async () => {
    await submitEvent(db, input({ ip: null }), deps);
    expect(hits[0][1]).toBe("unknown");
  });

  it("a field error returns at once: no rate limit, no Turnstile, nothing written", async () => {
    const result = await submitEvent(db, input({ values: values({ title: "" }) }), deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: { title: expect.any(String) } });
    expect(deps.hitRateLimit).not.toHaveBeenCalled();
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a filled honeypot looks like success, writes nothing, and calls no check", async () => {
    const result = await submitEvent(db, input({ honeypot: "https://spam.example", image: new Uint8Array([1]) }), deps);
    expect(result).toEqual({ ok: true, event: null });
    expect(deps.hitRateLimit).not.toHaveBeenCalled();
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect(deps.storeImage).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a refused rate limit writes nothing and does not call Turnstile", async () => {
    deps.hitRateLimit.mockImplementation(async (rule: RateLimitRule) => ({
      allowed: rule.bucket !== "submission-ip-day",
      retryAfterSeconds: 5400,
    }));
    const result = await submitEvent(db, input(), deps);
    expect(result).toEqual({ ok: false, reason: "limited", message: limitedMessage(5400), retryAfterSeconds: 5400 });
    expect(deps.hitRateLimit).toHaveBeenCalledTimes(2);
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a rate-limit check that throws refuses the Submission and logs the error class and code only", async () => {
    deps.hitRateLimit.mockRejectedValue(Object.assign(new Error("connect to postgres://secret"), { code: "ECONNREFUSED" }));
    const result = await submitEvent(db, input(), deps);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: MESSAGES.unavailable });
    expect(deps.log).toHaveBeenCalledWith("[submissions] Rate limit check failed: Error code=ECONNREFUSED");
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("a failed Turnstile check writes nothing; a Turnstile error refuses too", async () => {
    deps.verifyTurnstile.mockResolvedValue("refused");
    expect(await submitEvent(db, input(), deps)).toEqual({ ok: false, reason: "turnstile", message: MESSAGES.turnstile });
    deps.verifyTurnstile.mockResolvedValue("error");
    expect(await submitEvent(db, input(), deps)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(deps.verifyTurnstile).toHaveBeenCalledWith("token", "203.0.113.9");
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("the image is processed only after every check passed, and its URL is stored", async () => {
    const order: string[] = [];
    deps.hitRateLimit.mockImplementation(async () => (order.push("limit"), { allowed: true, retryAfterSeconds: 0 }));
    deps.verifyTurnstile.mockImplementation(async () => (order.push("turnstile"), "passed"));
    deps.storeImage.mockImplementation(async () => (order.push("image"), { ok: true, url: IMAGE_URL, width: 1, height: 1 }));
    const result = await submitEvent(db, input({ image: new Uint8Array([1, 2, 3]) }), deps);
    expect(order).toEqual(["limit", "limit", "turnstile", "limit", "image"]);
    if (!result.ok || !result.event) throw new Error("not saved");
    expect((await eventRow(db, result.event.id)).imageUrl).toBe(IMAGE_URL);
  });

  it("a refused image writes nothing and names the image field", async () => {
    deps.storeImage.mockResolvedValue({ ok: false, error: "Use a JPEG, PNG, GIF, WebP, or AVIF image." });
    const result = await submitEvent(db, input({ image: new Uint8Array([1]) }), deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: { image: "Use a JPEG, PNG, GIF, WebP, or AVIF image." } });
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("an image with no Blob store is refused before any check", async () => {
    const result = await submitEvent(db, input({ image: new Uint8Array([1]) }), { ...deps, storeImage: null });
    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: { image: MESSAGES.noImageStore } });
    expect(deps.hitRateLimit).not.toHaveBeenCalled();
  });

  it("a retired Tag or a Tag of the other Calendar is refused", async () => {
    const retired = await addTag(db, "rides", "old", true);
    const other = await addTag(db, "advocacy", "meeting");
    for (const tag of [retired, other]) {
      const result = await submitEvent(db, input({ values: values({ tagIds: [tag] }) }), deps);
      expect(result).toMatchObject({ ok: false, reason: "invalid", errors: { tags: expect.any(String) } });
    }
    expect((await rowCounts(db)).events).toBe(0);
  });

  it("limited messages give minutes, or hours for a long wait", () => {
    expect(limitedMessage(30)).toBe("Too many Submissions. Try again in 1 minute.");
    expect(limitedMessage(1800)).toBe("Too many Submissions. Try again in 30 minutes.");
    expect(limitedMessage(20000)).toBe("Too many Submissions. Try again in 6 hours.");
  });
});
