import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CALENDARS } from "@/db/schema";
import type { CalendarSlug } from "@/engine";
import { AgendaPage } from "../_components/agenda-page";
import { CALENDAR_NAMES } from "../_components/agenda-list";

// Cache Components does not allow `dynamicParams`; an unknown slug renders on request and gets a
// 404 from `notFound()` below.
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
