import type { Metadata } from "next";
import { CALENDAR_NAMES, SITE_ORIGIN } from "@/agenda/site";
import { AgendaPage } from "../_components/agenda-page";

export const metadata: Metadata = {
  title: `${CALENDAR_NAMES.rides} — Bike GR Calendar`,
  alternates: { canonical: `${SITE_ORIGIN}/rides` },
};

export default function RidesPage({ searchParams }: PageProps<"/rides">) {
  return <AgendaPage title={CALENDAR_NAMES.rides} calendar="rides" searchParams={searchParams} />;
}
