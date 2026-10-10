/** Create an Event in the admin. It is `approved`; its creator is also its reviewer. */
import { ctaToColumns, ruleInputToColumns } from "@/db/mappers";
import { events } from "@/db/schema";
import type { Db } from "@/db/types";
import type { ContentDraft, EventDraft } from "./event-input";
import { type Actor, checkTagIds, runWrite, setEventTags, writeHistory, type WriteResult } from "./write-helpers";

/** Content columns of an Event, from a draft. */
export function contentColumns(draft: ContentDraft) {
  return {
    calendar: draft.calendar,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    imageUrl: draft.imageUrl,
    ...ctaToColumns(draft.cta),
  };
}

export async function createEvent(
  db: Db,
  actor: Actor,
  draft: EventDraft,
): Promise<WriteResult<{ id: string }>> {
  return runWrite(db, async (tx) => {
    await checkTagIds(tx, draft.calendar, draft.tagIds, []);
    const now = new Date();
    const [row] = await tx
      .insert(events)
      .values({
        ...contentColumns(draft),
        ...ruleInputToColumns({ eventId: "", ...draft.rule }),
        reviewStatus: "approved",
        reviewedBy: actor.id,
        reviewedAt: now,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: events.id });
    await setEventTags(tx, row.id, draft.calendar, draft.tagIds);
    await writeHistory(tx, row.id, "create", actor);
    return { id: row.id };
  });
}
