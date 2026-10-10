import type { Metadata } from "next";
import { calendarName, calendarPath } from "@/agenda/site";
import { submissionCalendar } from "@/submissions/submission-input";
import { SiteHeader } from "../../_components/site-header";

export const metadata: Metadata = {
  title: "Thank you — Bike GR Calendar",
  robots: { index: false, follow: true },
};

export const instant = false;

async function BackLink({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const calendar = submissionCalendar((await searchParams).calendar);
  return (
    <p className="flex flex-wrap gap-6">
      <a href={calendarPath(calendar)} className="font-normal text-brand-green-text underline underline-offset-4">
        Back to {calendarName(calendar)}
      </a>
      <a href={`/submit?calendar=${calendar}`} className="font-normal text-brand-green-text underline underline-offset-4">
        Submit another event
      </a>
    </p>
  );
}

/** After a Submission (a redirect, so a reload does not send the form again). No Event details. */
export default function ThanksPage({ searchParams }: PageProps<"/submit/thanks">) {
  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1 bg-brand-page text-[15.84px] font-light leading-[1.9] text-brand-gray">
        <div className="mx-auto max-w-[760px] px-6 py-12 sm:px-[38px] sm:py-16">
          <h1 className="mb-4 font-chivo text-[34px] font-normal leading-tight sm:text-[46.72px]">Thank you</h1>
          <p className="mb-8">
            We got your event. An Editor reviews it before it is public. You get an email after the review.
          </p>
          <BackLink searchParams={searchParams} />
        </div>
      </main>
    </>
  );
}
