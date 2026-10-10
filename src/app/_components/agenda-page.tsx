import Link from "next/link";
import { Suspense } from "react";
import type { FilterParams } from "@/agenda/filters";
import type { CalendarSlug } from "@/engine";
import { AgendaList } from "./agenda-list";

/**
 * Static shell (prerendered) around the agenda. The agenda reads the search params and the
 * database at request time, so it is inside <Suspense>.
 */
export function AgendaPage({
  title,
  calendar,
  searchParams,
}: {
  title: string;
  calendar: CalendarSlug | null;
  searchParams: Promise<FilterParams>;
}) {
  return (
    <main className="w-full flex-1 bg-brand-page text-brand-gray">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-chivo text-sm">
            <Link href="/" className="underline">
              Bike GR Calendar
            </Link>
          </p>
          <a
            href="https://www.bikegr.org"
            className="rounded-[300px] bg-brand-green-text px-4 py-1.5 font-chivo text-sm font-bold text-white hover:bg-brand-gray"
          >
            Visit bikegr.org
          </a>
        </div>
        <h1 className="mb-4 font-chivo text-[28px] leading-tight sm:text-[34px]">{title}</h1>
        <Suspense fallback={<p>Loading events…</p>}>
          <AgendaList calendar={calendar} searchParams={searchParams} variant="site" />
        </Suspense>
      </div>
    </main>
  );
}
