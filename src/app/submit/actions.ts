"use server";

/**
 * The public Submission form's Server Action. Thin: the environment, the request IP, and the real
 * checks go into `submitEvent` (src/submissions/submit-event.ts), which has the rules and the order.
 * The new-Submission email goes after the response (`after`), so a slow or failed send never
 * changes the result. No public cache clear: a pending Event is not public.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { FieldErrors } from "@/admin/events/event-input";
import { MAX_UPLOAD_BYTES } from "@/admin/images/limits";
import { uploadEventImage } from "@/admin/images/upload-image";
import { todayInDetroit } from "@/agenda/dates";
import { getDb } from "@/db";
import { appOrigin, notifyNewSubmission } from "@/email/notify";
import { createEmailTransport } from "@/email/transport";
import { blobCredentials, vercelBlobStore } from "@/import/images";
import { clientIp, hitRateLimit } from "@/rate-limit";
import { submissionFromFormData } from "@/submissions/form-data";
import { MESSAGES, submitEvent } from "@/submissions/submit-event";
import { submissionCalendar } from "@/submissions/submission-input";
import { turnstileConfig, verifyTurnstile } from "@/submissions/turnstile";

/** After each error the form gets a new Turnstile token (a token works once). */
export type SubmitState = { status: "idle" } | { status: "error"; message: string; errors: FieldErrors };

export async function submitEventAction(_prev: SubmitState, data: FormData): Promise<SubmitState> {
  const config = turnstileConfig(process.env);
  if (!config) return { status: "error", message: MESSAGES.closed, errors: {} };

  const form = submissionFromFormData(data);
  if (form.image && form.image.size > MAX_UPLOAD_BYTES) {
    return {
      status: "error",
      message: "Check the marked fields.",
      errors: { image: "The image is larger than 4 MB. Make it smaller and try again." },
    };
  }

  const db = getDb();
  const store = blobCredentials(process.env) ? vercelBlobStore() : null;
  const ip = clientIp(await headers());
  const result = await submitEvent(
    db,
    {
      values: form.values,
      honeypot: form.honeypot,
      turnstileToken: form.turnstileToken,
      ip,
      image: form.image ? new Uint8Array(await form.image.arrayBuffer()) : null,
    },
    {
      today: todayInDetroit(new Date()),
      hitRateLimit: (rule, key) => hitRateLimit(db, rule, key),
      verifyTurnstile: (token, from) => verifyTurnstile(token, from, { secret: config.secret }),
      storeImage: store ? (bytes) => uploadEventImage(bytes, { store }) : null,
    },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      errors: result.reason === "invalid" ? result.errors : {},
    };
  }
  if (result.event) {
    const event = result.event;
    after(() => notifyNewSubmission(db, createEmailTransport(), event, appOrigin()));
  }
  redirect(`/submit/thanks?calendar=${submissionCalendar(form.values.calendar)}`);
}
