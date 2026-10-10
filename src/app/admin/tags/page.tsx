import { Suspense } from "react";
import { listTagsForAdmin } from "@/admin/tags/tags";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { CALENDARS } from "@/db/schema";
import type { CalendarSlug } from "@/engine";
import { CALENDAR_NAMES } from "@/app/_components/agenda-list";
import { AddTagForm, TagActions } from "./tag-forms";

async function CalendarTags({ calendar }: { calendar: CalendarSlug }) {
  const list = await listTagsForAdmin(getDb(), calendar);
  const active = list.filter((t) => t.retiredAt === null);
  const headingId = `tags-${calendar}`;

  return (
    <section aria-labelledby={headingId} className="mb-10">
      <h2 id={headingId} className="mb-3 text-xl font-semibold">
        {CALENDAR_NAMES[calendar]}
      </h2>
      <AddTagForm calendar={calendar} />
      {list.length === 0 ? (
        <p>No Tags yet.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Slug</th>
              <th className="py-2 pr-4">Events</th>
              <th className="py-2 pr-4">Active / retired</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((tag) => (
              <tr key={tag.id} className="border-b border-gray-200 align-top">
                <td className="py-2 pr-4">{tag.name}</td>
                <td className="py-2 pr-4 font-mono text-sm">{tag.slug}</td>
                <td className="py-2 pr-4">{tag.eventCount}</td>
                <td className="py-2 pr-4">{tag.retiredAt ? "Retired" : "Active"}</td>
                <td className="py-2">
                  <TagActions
                    tag={{
                      id: tag.id,
                      name: tag.name,
                      slug: tag.slug,
                      retired: tag.retiredAt !== null,
                      eventCount: tag.eventCount,
                    }}
                    mergeTargets={active.filter((t) => t.id !== tag.id).map((t) => ({ id: t.id, name: t.name }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function TagLists() {
  await requireEditor();
  return (
    <>
      <p className="mb-6 max-w-2xl">
        Each Calendar has its own Tags. Renaming a Tag keeps its slug, so shared filter links keep
        working. A retired Tag keeps its Events but is hidden on the public calendar and in the
        Event form.
      </p>
      {CALENDARS.map((calendar) => (
        <CalendarTags key={calendar} calendar={calendar} />
      ))}
    </>
  );
}

export default function AdminTagsPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Tags</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <TagLists />
      </Suspense>
    </>
  );
}
