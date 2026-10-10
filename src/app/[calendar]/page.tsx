import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CALENDARS } from "@/db/schema";
import type { CalendarSlug } from "@/engine";
import { AgendaPage } from "../_components/agenda-page";
import { CALENDAR_NAMES } from "../_components/agenda-list";

// Cache Components does not allow `dynamicParams`; an unknown slug renders on request and gets a
// 404 from `notFound()` below.
//
// The page reads `params` outside <Suspense> on purpose: `notFound()` must run before streaming
// starts, or the status stays 200 (not-found.md, "Before streaming starts"). That makes the shared
// App Shell depend on the URL, so the route opts out of instant-navigation validation. Only
// /rides and /advocacy exist, and both are prerendered by generateStaticParams.
export const instant = false;

export function generateStaticParams() {
  return CALENDARS.map((calendar) => ({ calendar }));
}

function toCalendar(slug: string): CalendarSlug {
  if (!(CALENDARS as readonly string[]).includes(slug)) notFound();
  return slug as CalendarSlug;
}

export async function generateMetadata({ params }: PageProps<"/[calendar]">): Promise<Metadata> {
  const calendar = toCalendar((await params).calendar);
  return { title: `${CALENDAR_NAMES[calendar]} — Bike GR Calendar` };
}

export default async function CalendarAgendaPage({ params }: PageProps<"/[calendar]">) {
  const calendar = toCalendar((await params).calendar);
  return <AgendaPage title={CALENDAR_NAMES[calendar]} calendar={calendar} />;
}
