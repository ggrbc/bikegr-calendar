"use client";

/**
 * The public Submission form, in the bikegr.org look. It posts FormData (the image file goes with
 * it) to `submitEventAction`. The submit handler stops the browser's own submit, so a refused send
 * keeps every value on screen. The Submitter never sees the words "Series" or "rule": the repeat is
 * "Repeats every week on [days] until [date]" or "Repeats every full moon until [date]".
 */
import { type FormEvent, type ReactNode, startTransition, useActionState, useCallback, useId, useState } from "react";
import { PREVIEW_MAX } from "@/admin/events/event-input";
import { ACCEPT, MAX_SELECT_BYTES, MAX_UPLOAD_BYTES } from "@/admin/images/limits";
import { ShrinkFailed, shrinkForUpload } from "@/admin/images/shrink-in-browser";
import type { PickerTag } from "@/admin/tags/tags";
import { shortDate } from "@/agenda/dates";
import { CALENDAR_NAMES } from "@/agenda/site";
import { addDays, addMinutes, type CalendarSlug, fullMoonDates, isLocalDate, isLocalDateTime } from "@/engine";
import { FIELDS } from "@/submissions/form-data";
import { HONEYPOT_LABEL } from "@/submissions/spam-rules";
import { LIMITS } from "@/submissions/submission-input";
import { MarkdownEditor } from "../_components/markdown-editor";
import { submitEventAction, type SubmitState } from "./actions";
import { TurnstileWidget } from "./turnstile-widget";

const input =
  "w-full rounded-[6px] border border-[#858486] bg-white px-4 py-2 text-[15.84px] font-light text-brand-gray";
const pillButton =
  "inline-flex items-center rounded-[300px] bg-brand-orange-text px-[28px] py-[12px] font-chivo text-[14px] uppercase tracking-[0.02em] text-white hover:bg-brand-gray disabled:opacity-60";
const legend = "mb-3 font-chivo text-[22px] font-normal";

const DAYS = [
  ["MO", "Mon"],
  ["TU", "Tue"],
  ["WE", "Wed"],
  ["TH", "Thu"],
  ["FR", "Fri"],
  ["SA", "Sat"],
  ["SU", "Sun"],
] as const;

const IDLE: SubmitState = { status: "idle" };

/** "Mon, Oct 26; Tue, Nov 24; or Wed, Dec 23": the next three full moons on or after `from`. */
function upcomingFullMoons(from: string): string {
  const date = isLocalDate(from) ? from : "";
  if (!date) return "";
  const dates = fullMoonDates(date, addDays(date, 100)).slice(0, 3).map(shortDate);
  return `${dates.slice(0, -1).join("; ")}; or ${dates[dates.length - 1]}`;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-[14px] font-normal text-brand-orange-text">
      {message}
    </p>
  );
}

/** A label, an optional hint, one control, and its error, with the ARIA links. */
function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = `${name}-${useId()}`;
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-normal">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-[14px]">
          {hint}
        </p>
      )}
      {children({ id, "aria-describedby": described || undefined, "aria-invalid": error ? true : undefined })}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** "+ Custom Preview" on the public form: uncontrolled, so it posts with the FormData. */
function SubmissionPreviewField({ error }: { error?: string }) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(0);
  if (!open && !error) {
    return (
      <button
        type="button"
        className="self-start font-normal text-brand-orange-text underline underline-offset-4"
        onClick={() => setOpen(true)}
      >
        + Custom Preview
      </button>
    );
  }
  return (
    <Field
      name="preview"
      label="Custom Preview"
      error={error}
      hint="Shown on the calendar list instead of the start of the description."
    >
      {(props) => (
        <>
          <textarea
            {...props}
            name={FIELDS.preview}
            rows={3}
            autoFocus
            onChange={(e) => setLength([...e.target.value.trim()].length)}
            className={input}
          />
          <p className="text-[14px]">
            {length} / {PREVIEW_MAX}
          </p>
        </>
      )}
    </Field>
  );
}

export function SubmissionForm({
  initialCalendar,
  tagsByCalendar,
  siteKey,
  imageEnabled,
  today,
}: {
  initialCalendar: CalendarSlug;
  tagsByCalendar: Record<CalendarSlug, PickerTag[]>;
  siteKey: string;
  imageEnabled: boolean;
  /** Today in Detroit, from the server: the earliest start date. */
  today: string;
}) {
  const [state, dispatch, sending] = useActionState(submitEventAction, IDLE);
  const [calendar, setCalendar] = useState<CalendarSlug>(initialCalendar);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [repeats, setRepeats] = useState(false);
  const [repeatKind, setRepeatKind] = useState<"weekly" | "fullMoon">("weekly");
  const [token, setToken] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const errors = state.status === "error" ? state.errors : {};

  const onToken = useCallback((value: string | null) => setToken(value), []);
  const onWidgetError = useCallback((message: string) => setClientError(message), []);

  function changeCalendar(next: CalendarSlug) {
    setCalendar(next);
    setTagIds([]); // Tags belong to one Calendar.
  }

  function changeAllDay(next: boolean) {
    setAllDay(next);
    setStart((s) => (next ? s.slice(0, 10) : s ? `${s.slice(0, 10)}T18:00` : ""));
    setEnd((e) => (next ? e.slice(0, 10) : e ? `${e.slice(0, 10)}T20:00` : ""));
  }

  /** A new start gives a default end: 2 hours later, or the same day. */
  function changeStart(next: string) {
    setStart(next);
    if (!allDay && isLocalDateTime(next) && (!isLocalDateTime(end) || end <= start || end < next)) {
      setEnd(addMinutes(next, 120));
    } else if (allDay && (end === "" || end < next)) {
      setEnd(next);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientError(null);
    const data = new FormData(event.currentTarget);
    data.set(FIELDS.turnstileToken, token ?? "");
    const file = data.get(FIELDS.image);
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_SELECT_BYTES) {
        setClientError("The image is larger than 10 MB. Pick a smaller file.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setPreparing(true);
        try {
          const smaller = await shrinkForUpload(file);
          data.set(FIELDS.image, smaller, file.name);
        } catch (error) {
          setClientError(error instanceof ShrinkFailed ? error.message : "The image cannot be read. Try a JPEG or PNG.");
          return;
        } finally {
          setPreparing(false);
        }
      }
    }
    startTransition(() => dispatch(data));
  }

  const tags = tagsByCalendar[calendar];
  const busy = sending || preparing;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-10" aria-describedby="submit-status">
      <div id="submit-status" aria-live="polite">
        {(state.status === "error" || clientError) && (
          <p role="alert" className="border-l-4 border-brand-orange bg-white px-4 py-3 font-normal text-brand-orange-text">
            {clientError ?? (state.status === "error" ? state.message : "")}
          </p>
        )}
      </div>

      <fieldset>
        <legend className={legend}>Calendar</legend>
        <div className="flex flex-wrap gap-6">
          {(Object.keys(CALENDAR_NAMES) as CalendarSlug[]).map((slug) => (
            <label key={slug} className="flex items-center gap-2">
              <input
                type="radio"
                name={FIELDS.calendar}
                value={slug}
                checked={calendar === slug}
                onChange={() => changeCalendar(slug)}
                className="size-4 accent-brand-orange-text"
              />
              {CALENDAR_NAMES[slug]}
            </label>
          ))}
        </div>
        <FieldError id="calendar-error" message={errors.calendar} />
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className={legend}>Your event</legend>
        <Field name="title" label="Title (required)" error={errors.title}>
          {(props) => <input {...props} name={FIELDS.title} required maxLength={200} className={input} />}
        </Field>
        <Field
          name="description"
          label="Description"
          error={errors.description}
          hint="Use the toolbar for headings, bold, lists, and links."
        >
          {(props) => <MarkdownEditor {...props} label="Description" name={FIELDS.description} />}
        </Field>
        <SubmissionPreviewField error={errors.preview} />
        <Field name="location" label="Location" error={errors.location} hint="A place name or an address.">
          {(props) => <input {...props} name={FIELDS.location} maxLength={LIMITS.location} className={input} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className={legend}>When (Grand Rapids time)</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name={FIELDS.allDay}
            checked={allDay}
            onChange={(e) => changeAllDay(e.target.checked)}
            className="size-4 accent-brand-orange-text"
          />
          All day
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="start" label={allDay ? "First day (required)" : "Starts (required)"} error={errors.start}>
            {(props) => (
              <input
                {...props}
                type={allDay ? "date" : "datetime-local"}
                name={FIELDS.start}
                value={start}
                min={allDay ? today : `${today}T00:00`}
                onChange={(e) => changeStart(e.target.value)}
                className={input}
              />
            )}
          </Field>
          <Field name="end" label={allDay ? "Last day (required)" : "Ends (required)"} error={errors.end}>
            {(props) => (
              <input
                {...props}
                type={allDay ? "date" : "datetime-local"}
                name={FIELDS.end}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={input}
              />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name={FIELDS.repeats}
            checked={repeats}
            onChange={(e) => setRepeats(e.target.checked)}
            className="size-4 accent-brand-orange-text"
          />
          Repeats
        </label>
        {repeats && (
          <div className="flex flex-col gap-5 border-l-2 border-brand-divider pl-5">
            <fieldset>
              <legend className="mb-2">How often</legend>
              <div className="flex flex-wrap gap-6">
                {(
                  [
                    ["weekly", "Every week"],
                    ["fullMoon", "Every full moon"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={FIELDS.repeatKind}
                      value={value}
                      checked={repeatKind === value}
                      onChange={() => setRepeatKind(value)}
                      className="size-4 accent-brand-orange-text"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {/* Hidden, not unmounted, so the picked days stay after a switch to full moon and back. */}
            <fieldset hidden={repeatKind !== "weekly"} aria-describedby={errors.repeatDays ? "repeat-days-error" : undefined}>
              <legend className="mb-2">On these days</legend>
              <div className="flex flex-wrap gap-4">
                {DAYS.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name={FIELDS.repeatDays} value={value} className="size-4 accent-brand-orange-text" />
                    {label}
                  </label>
                ))}
              </div>
              <FieldError id="repeat-days-error" message={errors.repeatDays} />
            </fieldset>
            {repeatKind === "fullMoon" && (
              <p className="text-[14px]">
                On the date of each full moon in Grand Rapids. Start on a full moon:{" "}
                {upcomingFullMoons(start.slice(0, 10) || today)}.
              </p>
            )}
            <Field
              name="repeat-until"
              label="Until (the date of the last one)"
              hint={`At most ${LIMITS.repeatMonths} months after the start.`}
              error={errors.repeatUntil}
            >
              {(props) => <input {...props} type="date" name={FIELDS.repeatUntil} min={today} className={`${input} sm:max-w-xs`} />}
            </Field>
          </div>
        )}
      </fieldset>

      {tags.length > 0 && (
        <fieldset aria-describedby={errors.tags ? "tags-error" : undefined}>
          <legend className={legend}>Tags</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={FIELDS.tagIds}
                  value={tag.id}
                  checked={tagIds.includes(tag.id)}
                  onChange={(e) =>
                    setTagIds((ids) => (e.target.checked ? [...ids, tag.id] : ids.filter((id) => id !== tag.id)))
                  }
                  className="size-4 accent-brand-orange-text"
                />
                {tag.name}
              </label>
            ))}
          </div>
          <FieldError id="tags-error" message={errors.tags} />
        </fieldset>
      )}

      {imageEnabled && (
        <fieldset>
          <legend className={legend}>Image</legend>
          <Field name="image" label="Image file (optional)" hint="JPEG, PNG, GIF, WebP, or AVIF, at most 10 MB." error={errors.image}>
            {(props) => <input {...props} type="file" name={FIELDS.image} accept={ACCEPT} className="text-[15px]" />}
          </Field>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-5">
        <legend className={legend}>Button (optional)</legend>
        <p className="-mt-2 text-[14px]">For example a “Register” button that opens your sign-up page.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="cta-label" label="Button label" error={errors.cta}>
            {(props) => <input {...props} name={FIELDS.ctaLabel} maxLength={LIMITS.ctaLabel} className={input} />}
          </Field>
          <Field name="cta-url" label="Web address (http:// or https://)">
            {(props) => <input {...props} type="url" name={FIELDS.ctaUrl} maxLength={LIMITS.ctaUrl} className={input} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className={legend}>About you</legend>
        <p className="-mt-2 text-[14px]">
          Only Bike GR Editors see your name and email. We use them only to contact you about this event.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="submitter-name" label="Your name (required)" error={errors.submitterName}>
            {(props) => (
              <input {...props} name={FIELDS.submitterName} autoComplete="name" maxLength={LIMITS.submitterName} className={input} />
            )}
          </Field>
          <Field name="submitter-email" label="Your email (required)" error={errors.submitterEmail}>
            {(props) => (
              <input
                {...props}
                type="email"
                name={FIELDS.submitterEmail}
                autoComplete="email"
                maxLength={LIMITS.submitterEmail}
                className={input}
              />
            )}
          </Field>
        </div>
      </fieldset>

      {/*
        Honeypot: off screen, out of the tab order, and hidden from screen readers, so only a bot
        fills it. Its name and label have no word that autofill knows (src/submissions/spam-rules.ts).
      */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {HONEYPOT_LABEL}
          <input type="text" name={FIELDS.honeypot} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {/* A token works once: each refused send (a new state object) gets a new one. */}
        <TurnstileWidget siteKey={siteKey} resetSignal={state.status === "error" ? state : null} onToken={onToken} onError={onWidgetError} />
        <div>
          <button type="submit" disabled={busy || token === null} className={pillButton}>
            {preparing ? "Preparing the image…" : sending ? "Sending…" : "Send the event"}
          </button>
        </div>
        {token === null && <p className="text-[14px]">The button works after the spam check above is done.</p>}
        <p className="text-[14px]">An Editor reviews each event before it is public.</p>
      </div>
    </form>
  );
}
