import type { Metadata } from "next";
import { io } from "next/cache";
import { requestBlobStore } from "@/admin/images/request-blob-store";
import { todayInDetroit } from "@/agenda/dates";
import { CALENDAR_NAMES, SITE_ORIGIN } from "@/agenda/site";
import { cachedPickerTags } from "@/submissions/picker-tags";
import { MESSAGES } from "@/submissions/submit-event";
import { submissionCalendar } from "@/submissions/submission-input";
import { turnstileConfig } from "@/submissions/turnstile";
import { SiteHeader } from "../_components/site-header";
import { SubmissionForm } from "./submission-form";

export const metadata: Metadata = {
  title: "Submit an Event — Bike GR Calendar",
  description: "Send a ride, a race, or a meeting to the Bike GR Calendar. An Editor reviews it first.",
  alternates: { canonical: `${SITE_ORIGIN}/submit` },
};

/** Blocking, like the agenda pages: the first HTML has the form. */
export const instant = false;

async function SubmitBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  await io();
  const calendar = submissionCalendar(search.calendar);
  const turnstile = turnstileConfig(process.env);
  if (!turnstile) {
    return (
      <p role="alert" className="font-normal">
        {MESSAGES.closed}
      </p>
    );
  }
  let tagsByCalendar;
  try {
    tagsByCalendar = await cachedPickerTags();
  } catch {
    return (
      <p role="alert" className="font-normal">
        The form could not load. Try again later.
      </p>
    );
  }
  return (
    <SubmissionForm
      initialCalendar={calendar}
      tagsByCalendar={tagsByCalendar}
      siteKey={turnstile.siteKey}
      imageEnabled={(await requestBlobStore()) !== null}
      today={todayInDetroit(new Date())}
    />
  );
}

/**
 * The public Submission form (`/submit?calendar=rides|advocacy`; the default is `rides`). The
 * bikegr.org header and look, as the agenda pages. Not in the Embed: `frame-ancestors 'none'`.
 */
export default function SubmitPage({ searchParams }: PageProps<"/submit">) {
  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1 bg-brand-page text-[15.84px] font-light leading-[1.9] text-brand-gray">
        <div className="mx-auto max-w-[760px] px-6 py-12 sm:px-[38px] sm:py-16">
          <h1 className="mb-4 font-chivo text-[34px] font-normal leading-tight sm:text-[46.72px]">Submit an Event</h1>
          <p className="mb-10">
            Send a ride, a race, a social event, or a meeting to the {CALENDAR_NAMES.rides} or the{" "}
            {CALENDAR_NAMES.advocacy} Calendar. An Editor reviews it first, and you get an email after the review.
          </p>
          <noscript>
            <p className="mb-6 font-normal">This form needs JavaScript for its spam check.</p>
          </noscript>
          <SubmitBody searchParams={searchParams} />
        </div>
      </main>
    </>
  );
}
