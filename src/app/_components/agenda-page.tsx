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
    <main className="w-full flex-1 bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-gray-700">
          <Link href="/" className="underline">
            Bike GR Calendar
          </Link>
        </p>
        <h1 className="mb-4 text-2xl font-semibold">{title}</h1>
        <Suspense fallback={<p className="text-gray-700">Loading events…</p>}>
          <AgendaList calendar={calendar} searchParams={searchParams} variant="site" />
        </Suspense>
      </div>
    </main>
  );
}
