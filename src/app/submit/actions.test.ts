/**
 * The Server Action wiring with the real rate limit (`@/rate-limit`) on PGlite: the request IP
 * from the headers, the Turnstile config from the environment, the redirect, and the email after
 * the response. Only Next.js, the database handle, and the network are replaced.
 */
import { count } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayInDetroit } from "@/agenda/dates";
import { addDays, dayOfWeek } from "@/engine";
import { WEEKDAYS } from "@/admin/events/rule-form";
import { events, rateLimits } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { addEditor } from "@/admin/events/test-helpers";

const state = vi.hoisted(() => ({
  db: null as unknown,
  headers: new Headers(),
  redirect: vi.fn(),
  after: vi.fn(),
  sent: [] as unknown[],
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/server", () => ({ after: state.after }));
vi.mock("@/email/transport", () => ({
  createEmailTransport: () => ({ kind: "capture", send: async (message: unknown) => void state.sent.push(message) }),
}));

import { submitEventAction } from "./actions";

const idle = { status: "idle" } as const;

function formData(title: string): FormData {
  const start = addDays(todayInDetroit(new Date()), 3);
  const data = new FormData();
  data.set("calendar", "advocacy");
  data.set("title", title);
  data.set("start", `${start}T18:00`);
  data.set("end", `${start}T20:00`);
  data.set("repeats", "on");
  data.append("repeatDays", WEEKDAYS[(dayOfWeek(start) + 6) % 7]);
  data.set("repeatUntil", addDays(start, 28));
  data.set("submitterName", "Sam Rider");
  data.set("submitterEmail", "sam@example.org");
  data.set("turnstileToken", "token");
  return data;
}

describe("submitEventAction with the real rate limit", () => {
  let db: Db;
  let close: () => Promise<void>;
  const siteverify = vi.fn<typeof fetch>(async () =>
    Response.json({ success: true, action: "submit", hostname: "localhost" }),
  );

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    state.db = db;
    state.headers = new Headers({ "x-forwarded-for": "203.0.113.7", host: "localhost:3000" });
    state.redirect.mockClear();
    state.after.mockClear();
    state.sent = [];
    siteverify.mockClear();
    vi.stubGlobal("fetch", siteverify);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("TURNSTILE_TEST_KEYS", "1");
    vi.stubEnv("TURNSTILE_SITEVERIFY_URL", "http://localhost:4100/turnstile/siteverify");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await close();
  });

  const eventCount = async () => (await db.select({ n: count() }).from(events))[0].n;

  it("saves a pending Event, counts the IP and the day in rate_limits, redirects, and emails after the response", async () => {
    await addEditor(db, "Erin Editor");
    await submitEventAction(idle, formData("Commission Meeting"));
    expect(state.redirect).toHaveBeenCalledWith("/submit/thanks?calendar=advocacy");
    expect(await eventCount()).toBe(1);
    const buckets = (await db.select({ bucket: rateLimits.bucket }).from(rateLimits)).map((r) => r.bucket).sort();
    expect(buckets).toEqual(["submission-all-day", "submission-ip-day", "submission-ip-hour"]);
    // The siteverify call goes to the stand-in URL, with the IP from the headers.
    const [url, init] = siteverify.mock.calls[0];
    expect(String(url)).toBe("http://localhost:4100/turnstile/siteverify");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("remoteip")).toBe("203.0.113.7");
    expect(state.sent).toHaveLength(0);
    await state.after.mock.calls[0][0]();
    expect(state.sent).toHaveLength(1);
  });

  it("the 4th Submission from one IP in an hour is refused with Too many Submissions", async () => {
    for (let i = 0; i < 3; i++) await submitEventAction(idle, formData(`Meeting ${i}`));
    const fourth = await submitEventAction(idle, formData("Meeting 4"));
    expect(fourth).toMatchObject({ status: "error", message: expect.stringMatching(/^Too many Submissions/) });
    expect(await eventCount()).toBe(3);
    expect(siteverify).toHaveBeenCalledTimes(3);
  });

  it("a siteverify pass for another hostname saves nothing and does not count against the day", async () => {
    siteverify.mockImplementation(async () => Response.json({ success: true, action: "submit", hostname: "other.example" }));
    const result = await submitEventAction(idle, formData("Meeting"));
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/spam check did not pass/) });
    expect(await eventCount()).toBe(0);
    const buckets = (await db.select({ bucket: rateLimits.bucket }).from(rateLimits)).map((r) => r.bucket);
    expect(buckets).not.toContain("submission-all-day");
  });

  it("with no Turnstile keys and no opt-in, the form is closed", async () => {
    vi.stubEnv("TURNSTILE_TEST_KEYS", "");
    const result = await submitEventAction(idle, formData("Meeting"));
    expect(result).toMatchObject({ status: "error", message: "Submissions are closed right now. Try again later." });
    expect(await eventCount()).toBe(0);
    expect(siteverify).not.toHaveBeenCalled();
  });
});
