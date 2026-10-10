import { Suspense } from "react";
import { listTagsForAdmin } from "@/admin/tags/tags";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { CALENDARS } from "@/db/schema";
import type { CalendarSlug } from "@/engine";
import { CALENDAR_NAMES } from "@/app/_components/agenda-list";
import {
  Badge,
  Card,
  EmptyState,
  mutedClass,
  PageHeader,
  stackRowClass,
  stackTableClass,
  stackTbodyClass,
  stackTdClass,
  stackTheadClass,
  theadRowClass,
  thClass,
} from "../_components/ui";
import { AddTagForm, TagActions } from "./tag-forms";

async function CalendarTags({ calendar }: { calendar: CalendarSlug }) {
  const list = await listTagsForAdmin(getDb(), calendar);
  const active = list.filter((t) => t.retiredAt === null);
  const headingId = `tags-${calendar}`;

  return (
    <Card title={CALENDAR_NAMES[calendar]} titleId={headingId} className="mb-8">
      <AddTagForm calendar={calendar} />
      {list.length === 0 ? (
        <EmptyState>No Tags yet.</EmptyState>
      ) : (
        // One markup: on a phone each row is a stacked block (ARIA roles keep the table semantics).
        <table role="table" className={stackTableClass}>
          <thead role="rowgroup" className={stackTheadClass}>
            <tr role="row" className={theadRowClass}>
              <th role="columnheader" className={thClass}>Name</th>
              <th role="columnheader" className={thClass}>Slug</th>
              <th role="columnheader" className={thClass}>Events</th>
              <th role="columnheader" className={thClass}>Active / retired</th>
              <th role="columnheader" className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup" className={stackTbodyClass}>
            {list.map((tag) => (
              <tr role="row" key={tag.id} className={stackRowClass}>
                <td role="cell" className={`${stackTdClass} font-semibold max-sm:before:content-none`}>
                  {tag.name}
                </td>
                <td role="cell" data-label="Slug" className={stackTdClass}>
                  <span className="font-mono text-sm">{tag.slug}</span>
                </td>
                <td role="cell" data-label="Events" className={stackTdClass}>
                  {tag.eventCount}
                </td>
                <td role="cell" className={`${stackTdClass} max-sm:before:content-none`}>
                  {tag.retiredAt ? <Badge tone="deleted">Retired</Badge> : <Badge tone="approved">Active</Badge>}
                </td>
                <td role="cell" className={`${stackTdClass} max-sm:pt-1 max-sm:before:content-none`}>
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
    </Card>
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
      <PageHeader title="Tags" />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <TagLists />
      </Suspense>
    </>
  );
}
