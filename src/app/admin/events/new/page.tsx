import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { emptyEventValues } from "@/admin/events/form-values";
// Stand-in until the `admin-people-tags-images` stream merges: then `@/admin/tags/tags`.
import { listPickerTags } from "@/admin/events/seams";
import { todayInDetroit } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { EventForm } from "../_components/event-form";

async function NewEvent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const editor = await requireEditor();
  const search = await searchParams;
  await io();
  const db = getDb();
  const today = todayInDetroit(new Date());
  const calendar = search.calendar === "advocacy" ? "advocacy" : "rides";
  const tagsByCalendar = {
    rides: await listPickerTags(db, "rides"),
    advocacy: await listPickerTags(db, "advocacy"),
  };
  return (
    <EventForm
      mode="create"
      initial={emptyEventValues(calendar, today)}
      tagsByCalendar={tagsByCalendar}
      isAdmin={editor.role === "admin"}
      today={today}
    />
  );
}

export default function NewEventPage({ searchParams }: PageProps<"/admin/events/new">) {
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/events" className="underline">
          Events
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold">New Event</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <NewEvent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
