/**
 * The public form's FormData as the untrusted input of `submitEvent`. The form posts FormData (not
 * a JSON model like the admin), because it carries the image file. Field names are fixed here and
 * used by the form.
 */
import { HONEYPOT_FIELD } from "./spam-rules";
import type { SubmissionValues } from "./submission-input";

export const FIELDS = {
  calendar: "calendar",
  title: "title",
  description: "description",
  preview: "preview",
  location: "location",
  tagIds: "tagIds",
  ctaLabel: "ctaLabel",
  ctaUrl: "ctaUrl",
  allDay: "allDay",
  start: "start",
  end: "end",
  repeats: "repeats",
  repeatDays: "repeatDays",
  repeatUntil: "repeatUntil",
  submitterName: "submitterName",
  submitterEmail: "submitterEmail",
  image: "image",
  turnstileToken: "turnstileToken",
  honeypot: HONEYPOT_FIELD,
} as const;

export interface SubmissionFormData {
  values: SubmissionValues;
  honeypot: string;
  turnstileToken: string;
  /** A picked file, or null (an empty file input sends an empty file). */
  image: File | null;
}

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function texts(data: FormData, key: string): string[] {
  return data.getAll(key).filter((v): v is string => typeof v === "string");
}

export function submissionFromFormData(data: FormData): SubmissionFormData {
  const image = data.get(FIELDS.image);
  return {
    values: {
      calendar: text(data, FIELDS.calendar),
      title: text(data, FIELDS.title),
      description: text(data, FIELDS.description),
      preview: text(data, FIELDS.preview),
      location: text(data, FIELDS.location),
      tagIds: texts(data, FIELDS.tagIds),
      ctaLabel: text(data, FIELDS.ctaLabel),
      ctaUrl: text(data, FIELDS.ctaUrl),
      allDay: data.has(FIELDS.allDay),
      start: text(data, FIELDS.start),
      end: text(data, FIELDS.end),
      repeats: data.has(FIELDS.repeats),
      repeatDays: texts(data, FIELDS.repeatDays),
      repeatUntil: text(data, FIELDS.repeatUntil),
      submitterName: text(data, FIELDS.submitterName),
      submitterEmail: text(data, FIELDS.submitterEmail),
    },
    honeypot: text(data, FIELDS.honeypot),
    turnstileToken: text(data, FIELDS.turnstileToken),
    image: image instanceof File && image.size > 0 ? image : null,
  };
}
