/**
 * The Submission emails: plain text and HTML for each. Pure. Every value in the HTML is escaped
 * (titles, names, and reasons come from forms).
 */
import type { CalendarSlug } from "@/engine";
import { CALENDAR_NAMES } from "@/agenda/site";
import { linkParagraph, paragraph } from "./html";

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Each part is a paragraph: plain text, or a link. */
type Part = string | { label: string; url: string };

function compose(subject: string, parts: Part[]): ComposedEmail {
  const text = parts.map((p) => (typeof p === "string" ? p : `${p.label}: ${p.url}`)).join("\n\n");
  const html = parts.map((p) => (typeof p === "string" ? paragraph(p) : linkParagraph(p.label, p.url))).join("");
  return { subject, text: `${text}\n`, html };
}

const SIGNATURE = "Bike GR Calendar — Greater Grand Rapids Bicycle Coalition";

export function composeNewSubmissionEmail(input: {
  calendar: CalendarSlug;
  title: string;
  /** The first date in words, and the repeat if there is one. */
  when: string;
  submitterName: string;
  reviewUrl: string;
  queueUrl: string;
}): ComposedEmail {
  const calendar = CALENDAR_NAMES[input.calendar];
  return compose(`New Submission for ${calendar}: ${input.title}`, [
    `${input.submitterName} sent a new event to the ${calendar} Calendar. It is not public until an Editor approves it.`,
    `${input.title}\n${input.when}`,
    { label: "Review this Submission", url: input.reviewUrl },
    { label: "Review queue", url: input.queueUrl },
  ]);
}

export function composeApprovedEmail(input: { calendar: CalendarSlug; title: string; eventUrl: string }): ComposedEmail {
  const calendar = CALENDAR_NAMES[input.calendar];
  return compose(`Your event is on the Bike GR Calendar: ${input.title}`, [
    `Thank you. An Editor approved your event "${input.title}". It is now on the ${calendar} Calendar.`,
    { label: "See your event", url: input.eventUrl },
    SIGNATURE,
  ]);
}

export function composeRejectedEmail(input: {
  calendar: CalendarSlug;
  title: string;
  reason: string | null;
}): ComposedEmail {
  const calendar = CALENDAR_NAMES[input.calendar];
  return compose(`Your event was not added to the Bike GR Calendar: ${input.title}`, [
    `Thank you for your Submission "${input.title}". An Editor did not add it to the ${calendar} Calendar.`,
    ...(input.reason ? [`Reason: ${input.reason}`] : []),
    "If you have questions, contact Bike GR at https://www.bikegr.org/contact.",
    SIGNATURE,
  ]);
}
