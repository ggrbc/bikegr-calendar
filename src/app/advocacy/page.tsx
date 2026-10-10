import type { Metadata } from "next";
import { CALENDAR_NAMES, SITE_ORIGIN } from "@/agenda/site";
import { AgendaPage } from "../_components/agenda-page";

export const metadata: Metadata = {
  title: `${CALENDAR_NAMES.advocacy} — Bike GR Calendar`,
  alternates: { canonical: `${SITE_ORIGIN}/advocacy` },
};

/** Blocking: the first HTML has the events, also without JavaScript. */
export const instant = false;

export default function AdvocacyPage({ searchParams }: PageProps<"/advocacy">) {
  return <AgendaPage title={CALENDAR_NAMES.advocacy} calendar="advocacy" searchParams={searchParams} />;
}
