import type { Metadata } from "next";
import { AgendaPage } from "../_components/agenda-page";
import { CALENDAR_NAMES } from "../_components/agenda-list";

export const metadata: Metadata = { title: `${CALENDAR_NAMES.rides} — Bike GR Calendar` };

export default function RidesPage() {
  return <AgendaPage title={CALENDAR_NAMES.rides} calendar="rides" />;
}
