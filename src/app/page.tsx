import type { Metadata } from "next";
import { ALL_NAME, SITE_ORIGIN } from "@/agenda/site";
import { AgendaPage } from "./_components/agenda-page";

export const metadata: Metadata = {
  title: `${ALL_NAME} — Bike GR Calendar`,
  alternates: { canonical: `${SITE_ORIGIN}/` },
};

export default function Home({ searchParams }: PageProps<"/">) {
  return <AgendaPage title={ALL_NAME} calendar={null} searchParams={searchParams} />;
}
