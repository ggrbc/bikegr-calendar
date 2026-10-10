import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { emptyEventValues } from "@/admin/events/form-values";
import { listPickerTags } from "@/admin/tags/tags";
import { todayInDetroit } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { linkClass, mutedClass, PageHeader } from "../../_components/ui";
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
      <PageHeader
        title="New Event"
        back={
          <Link href="/admin/events" className={linkClass}>
            Events
          </Link>
        }
      />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <NewEvent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
