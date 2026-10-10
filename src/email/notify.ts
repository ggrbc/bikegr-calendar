/**
 * Who gets which Submission email. A send error never fails the write that came before it: it is
 * logged with the email kind and the error class only (no address, no content).
 */
import { isNull } from "drizzle-orm";
import { describeRrule } from "@/admin/events/describe-rule";
import { nextOccurrences } from "@/admin/events/preview";
import { shortSlot } from "@/agenda/dates";
import { occurrencePath } from "@/agenda/occurrence-url";
import { calendarPath, SITE_ORIGIN } from "@/agenda/site";
import { editors } from "@/db/schema";
import type { Db } from "@/db/types";
import type { LocalDate } from "@/engine";
import type { ReviewedEvent } from "@/submissions/review";
import type { SubmittedEvent } from "@/submissions/submit-event";
import { composeApprovedEmail, composeNewSubmissionEmail, composeRejectedEmail } from "./submission-emails";
import type { EmailMessage, EmailTransport } from "./transport";

type Log = (line: string) => void;

/** Links in emails: the `AUTH_URL` origin (localhost in development), else the production site. */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  try {
    return env.AUTH_URL ? new URL(env.AUTH_URL).origin : SITE_ORIGIN;
  } catch {
    return SITE_ORIGIN;
  }
}

async function safeSend(kind: string, transport: EmailTransport, message: EmailMessage, log: Log): Promise<void> {
  try {
    await transport.send(message);
  } catch (error) {
    log(`[email] ${kind} failed: ${error instanceof Error ? error.constructor.name : typeof error}`);
  }
}

const defaultLog: Log = (line) => console.error(line);

/** One email to each active Editor (not deactivated). */
export async function notifyNewSubmission(
  db: Db,
  transport: EmailTransport,
  event: SubmittedEvent,
  origin: string,
  log: Log = defaultLog,
): Promise<void> {
  let to: string[];
  try {
    const rows = await db.select({ email: editors.email }).from(editors).where(isNull(editors.deactivatedAt));
    to = rows.map((r) => r.email);
  } catch (error) {
    log(`[email] new-submission failed: ${error instanceof Error ? error.constructor.name : typeof error}`);
    return;
  }
  if (to.length === 0) return;
  const { draft } = event;
  const when = draft.rule.rrule
    ? `${shortSlot(draft.rule.timing)}\n${describeRrule(draft.rule.rrule)}`
    : shortSlot(draft.rule.timing);
  const email = composeNewSubmissionEmail({
    calendar: draft.calendar,
    title: draft.title,
    when,
    submitterName: event.submitter.name,
    reviewUrl: `${origin}/admin/events/${event.id}`,
    queueUrl: `${origin}/admin/review`,
  });
  // One message per Editor: a shared `to` list would show each Editor's address to all the others.
  for (const address of to) await safeSend("new-submission", transport, { to: [address], ...email }, log);
}

export async function notifyApproved(
  transport: EmailTransport,
  review: ReviewedEvent,
  origin: string,
  today: LocalDate,
  log: Log = defaultLog,
): Promise<void> {
  if (!review.submitterEmail) return;
  const next = nextOccurrences(review.rule, [], today, 1);
  const first = next.ok ? next.occurrences[0] : undefined;
  const eventUrl = first
    ? `${origin}${occurrencePath(review.id, first.originalStart)}`
    : `${origin}${calendarPath(review.calendar)}`;
  const email = composeApprovedEmail({ calendar: review.calendar, title: review.title, eventUrl });
  await safeSend("approved", transport, { to: [review.submitterEmail], ...email }, log);
}

export async function notifyRejected(
  transport: EmailTransport,
  review: ReviewedEvent,
  reason: string | null,
  log: Log = defaultLog,
): Promise<void> {
  if (!review.submitterEmail) return;
  const email = composeRejectedEmail({ calendar: review.calendar, title: review.title, reason });
  await safeSend("rejected", transport, { to: [review.submitterEmail], ...email }, log);
}
