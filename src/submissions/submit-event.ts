/**
 * A public Submission: the checks in a fixed order, then one pending Event. Plan:
 * docs/plans/submissions-and-review-queue.md ("Approach" 2).
 *
 * 1. Parse (pure). A field error returns at once: it spends no Turnstile token and no rate limit.
 * 2. Honeypot. Filled: the caller shows the thank-you page; nothing is counted or written.
 * 3. Rate limits per IP (an hour, a day). They protect the siteverify calls.
 * 4. Turnstile on the server.
 * 5. The rate limit of all Submissions (a day), only for a Turnstile pass (Q51 = A): bots with no
 *    pass must not close the form for real Submitters; the limit protects the Resend quota.
 *    A rate-limit check that throws refuses the Submission (fail closed), in step 3 and here.
 * 6. The image (sharp, Blob), only now: no image work for a request that failed a check.
 * 7. One transaction: the Event (`pending`, no `created_by`, the Submitter fields), its Tags, and a
 *    `submit` history row with no Editor.
 *
 * The checks come in as functions, so the tests run this on PGlite with stubs.
 */
import { contentColumns } from "@/admin/events/create-event";
import type { EventDraft, FieldErrors } from "@/admin/events/event-input";
import { checkTagIds, runWrite, setEventTags, writeHistory } from "@/admin/events/write-helpers";
import type { UploadResult } from "@/admin/images/upload-image";
import { ruleInputToColumns } from "@/db/mappers";
import { events } from "@/db/schema";
import type { Db } from "@/db/types";
import type { LocalDate } from "@/engine";
import {
  GLOBAL_KEY,
  type RateLimitResult,
  type RateLimitRule,
  SUBMISSION_GLOBAL_RULE,
  SUBMISSION_IP_RULES,
  UNKNOWN_IP_KEY,
} from "./spam-rules";
import { parseSubmissionInput, type Submitter } from "./submission-input";
import type { TurnstileVerdict } from "./turnstile";

export interface SubmitInput {
  /** The form values (untrusted). */
  values: unknown;
  /** The honeypot field value. */
  honeypot: string;
  turnstileToken: string;
  ip: string | null;
  /** The picked image file, or null. */
  image: Uint8Array | null;
}

export interface SubmitDeps {
  today: LocalDate;
  hitRateLimit: (rule: RateLimitRule, key: string) => Promise<RateLimitResult>;
  verifyTurnstile: (token: string, ip: string | null) => Promise<TurnstileVerdict>;
  /** Null when the environment has no Blob store. */
  storeImage: ((bytes: Uint8Array) => Promise<UploadResult>) | null;
  log?: (line: string) => void;
}

/** What the new-Submission email needs. */
export interface SubmittedEvent {
  id: string;
  draft: EventDraft;
  submitter: Submitter;
}

export type SubmitResult =
  | { ok: true; event: SubmittedEvent }
  /** The honeypot was filled: show the thank-you page; nothing was written. */
  | { ok: true; event: null }
  | { ok: false; reason: "invalid"; message: string; errors: FieldErrors }
  | { ok: false; reason: "limited"; message: string; retryAfterSeconds: number }
  | { ok: false; reason: "turnstile"; message: string }
  | { ok: false; reason: "unavailable"; message: string };

export const MESSAGES = {
  invalid: "Check the marked fields.",
  turnstile: "The spam check did not pass. Do the check again, then send the form.",
  unavailable: "Submissions do not work right now. Try again later.",
  noImageStore: "Image upload is not set up. Remove the image, or try again later.",
  failed: "The Submission was not saved. Try again.",
  closed: "Submissions are closed right now. Try again later.",
} as const;

export function limitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  if (minutes < 120) return `Too many Submissions. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  return `Too many Submissions. Try again in ${Math.ceil(minutes / 60)} hours.`;
}

/** One log line with the error class and the code only: a message can hold input values. */
function errorLine(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = "code" in error ? ` code=${String((error as { code: unknown }).code)}` : "";
  return `${error.constructor.name}${code}`;
}

/** Hits each rule in order; the first refusal or error stops. A thrown check refuses (fail closed). */
async function checkRateLimits(
  deps: SubmitDeps,
  checks: [RateLimitRule, string][],
): Promise<{ ok: true } | { ok: false; result: SubmitResult }> {
  for (const [rule, key] of checks) {
    let hit: RateLimitResult;
    try {
      hit = await deps.hitRateLimit(rule, key);
    } catch (error) {
      (deps.log ?? console.error)(`[submissions] Rate limit check failed: ${errorLine(error)}`);
      return { ok: false, result: { ok: false, reason: "unavailable", message: MESSAGES.unavailable } };
    }
    if (!hit.allowed) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "limited",
          message: limitedMessage(hit.retryAfterSeconds),
          retryAfterSeconds: hit.retryAfterSeconds,
        },
      };
    }
  }
  return { ok: true };
}

export async function submitEvent(db: Db, input: SubmitInput, deps: SubmitDeps): Promise<SubmitResult> {
  const parsed = parseSubmissionInput(input.values, { today: deps.today });
  if (!parsed.ok) return { ok: false, reason: "invalid", message: MESSAGES.invalid, errors: parsed.errors };
  if (input.image && !deps.storeImage) {
    return { ok: false, reason: "invalid", message: MESSAGES.invalid, errors: { image: MESSAGES.noImageStore } };
  }

  if (input.honeypot.trim() !== "") return { ok: true, event: null };

  // Per IP before Turnstile: they protect the siteverify calls.
  const ipKey = input.ip ?? UNKNOWN_IP_KEY;
  const perIp = await checkRateLimits(deps, SUBMISSION_IP_RULES.map((rule): [RateLimitRule, string] => [rule, ipKey]));
  if (!perIp.ok) return perIp.result;

  const verdict = await deps.verifyTurnstile(input.turnstileToken, input.ip);
  if (verdict === "error") return { ok: false, reason: "unavailable", message: MESSAGES.unavailable };
  if (verdict === "refused") return { ok: false, reason: "turnstile", message: MESSAGES.turnstile };

  // All Submissions together, only after a Turnstile pass (Q51 = A): bots with no pass must not use
  // up the day's budget and close the form for real Submitters. It protects the Resend quota.
  const global = await checkRateLimits(deps, [[SUBMISSION_GLOBAL_RULE, GLOBAL_KEY]]);
  if (!global.ok) return global.result;

  let draft = parsed.value.event;
  if (input.image && deps.storeImage) {
    const stored = await deps.storeImage(input.image);
    if (!stored.ok) return { ok: false, reason: "invalid", message: MESSAGES.invalid, errors: { image: stored.error } };
    draft = { ...draft, imageUrl: stored.url };
  }

  const { submitter } = parsed.value;
  const written = await runWrite(db, async (tx) => {
    await checkTagIds(tx, draft.calendar, draft.tagIds, []);
    const now = new Date();
    const [row] = await tx
      .insert(events)
      .values({
        ...contentColumns(draft),
        ...ruleInputToColumns({ eventId: "", ...draft.rule }),
        reviewStatus: "pending",
        submitterName: submitter.name,
        submitterEmail: submitter.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: events.id });
    await setEventTags(tx, row.id, draft.calendar, draft.tagIds);
    await writeHistory(tx, row.id, "submit", null);
    return { id: row.id };
  });
  if (!written.ok) {
    if (written.reason === "invalid") {
      return { ok: false, reason: "invalid", message: written.message, errors: written.errors };
    }
    return { ok: false, reason: "unavailable", message: MESSAGES.failed };
  }
  return { ok: true, event: { id: written.id, draft, submitter } };
}
