/**
 * Event managers: the grants that link a person (role `event_manager`) to an Event, and the Editor
 * writes that add and remove them. See docs/plans/event-managers.md.
 *
 * A grant does not bump the Event's `version` (an open Event form does not conflict with it) but it
 * writes history with the Editor's name. The database cannot check that the account has the
 * `event_manager` role (a CHECK cannot read another table), so these writes do.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { ROLE_LABELS } from "@/admin/editors/rules";
import { isValidEmail, normalizeEmail, parseEditorName } from "@/auth/rules";
import { type Editor, editors, eventManagers, type EventRow, events } from "@/db/schema";
import type { Db } from "@/db/types";
import { NOT_FOUND_MESSAGE } from "./format";
import {
  type Actor,
  invalid,
  runWrite,
  type Tx,
  WriteError,
  type WriteResult,
  writeHistory,
} from "./write-helpers";

export const NOT_APPROVED_MESSAGE = "Only an approved Event can have managers. Approve it first.";
export const DEACTIVATED_MESSAGE = "This person is deactivated. Ask an Admin to reactivate them first.";

/** `no-effect`: the person is an Editor or Admin now, so the grant does nothing. */
export type ManagerStatus = "invited" | "active" | "deactivated" | "no-effect";

export interface ManagerRow {
  editorId: string;
  name: string | null;
  email: string;
  role: Editor["role"];
  status: ManagerStatus;
}

const label = (editor: Pick<Editor, "name" | "email">) => editor.name ?? editor.email;

function statusOf(editor: Pick<Editor, "deactivatedAt" | "emailVerified" | "role">): ManagerStatus {
  if (editor.role !== "event_manager") return "no-effect";
  if (editor.deactivatedAt) return "deactivated";
  return editor.emailVerified ? "active" : "invited";
}

function assertEditorActor(actor: Actor): void {
  if (actor.role !== "editor" && actor.role !== "admin") {
    throw new WriteError({ ok: false, reason: "invalid", message: "Only an Editor can change managers.", errors: {} });
  }
}

async function loadApprovedEvent(tx: Tx, eventId: string): Promise<EventRow> {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!row) throw new WriteError({ ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE });
  if (row.deletedAt !== null) {
    throw new WriteError({ ok: false, reason: "deleted", message: "This Event was deleted." });
  }
  if (row.reviewStatus !== "approved") throw invalid({}, NOT_APPROVED_MESSAGE);
  return row;
}

async function findByEmail(tx: Tx, email: string): Promise<Editor | undefined> {
  const [row] = await tx.select().from(editors).where(eq(editors.email, email));
  return row;
}

export type AddManagerResult = WriteResult<{
  /** `invited`: a new account. `granted`: an existing Event manager. `already`: no change. */
  kind: "invited" | "granted" | "already";
  editor: Editor;
}>;

/**
 * Adds a manager to an approved Event. A new email makes a new account with role `event_manager`
 * (the caller sends the invite). An existing Event manager gets the grant. An Editor, an Admin,
 * or a deactivated account is refused.
 */
export async function addManager(
  db: Db,
  actor: Actor,
  input: { eventId: string; email: unknown; name: unknown },
): Promise<AddManagerResult> {
  return runWrite(db, async (tx) => {
    assertEditorActor(actor);
    await loadApprovedEvent(tx, input.eventId);

    const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
    if (!isValidEmail(email)) throw invalid({ email: "Enter a valid email address." });

    let person = await findByEmail(tx, email);
    let kind: "invited" | "granted" | "already" = "granted";
    if (!person) {
      const name = parseEditorName(input.name);
      if (!name.ok) throw invalid({ name: name.error });
      const [created] = await tx
        .insert(editors)
        .values({ email, name: name.value, role: "event_manager", invitedBy: actor.id, invitedAt: new Date() })
        .onConflictDoNothing({ target: editors.email })
        .returning();
      // A person who was created at the same moment: use that account.
      person = created ?? (await findByEmail(tx, email));
      if (created) kind = "invited";
    }
    if (!person) throw invalid({ email: "This person could not be added. Try again." });

    if (person.deactivatedAt) throw invalid({ email: DEACTIVATED_MESSAGE }, DEACTIVATED_MESSAGE);
    if (person.role !== "event_manager") {
      const message = `${label(person)} is an ${ROLE_LABELS[person.role]} and can already change every Event.`;
      throw invalid({ email: message }, message);
    }

    const inserted = await tx
      .insert(eventManagers)
      .values({ eventId: input.eventId, editorId: person.id, grantedBy: actor.id })
      .onConflictDoNothing()
      .returning({ editorId: eventManagers.editorId });
    if (inserted.length === 0) return { kind: "already" as const, editor: person };

    await writeHistory(tx, input.eventId, "manager-add", actor, { manager: label(person) });
    return { kind, editor: person };
  });
}

/** Removes a grant. The account stays. A grant that is gone already is a quiet no-op. */
export async function removeManager(
  db: Db,
  actor: Actor,
  input: { eventId: string; editorId: string },
): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    assertEditorActor(actor);
    const [person] = await tx.select().from(editors).where(eq(editors.id, input.editorId));
    const removed = await tx
      .delete(eventManagers)
      .where(and(eq(eventManagers.eventId, input.eventId), eq(eventManagers.editorId, input.editorId)))
      .returning({ editorId: eventManagers.editorId });
    if (removed.length === 0 || !person) return {};
    await writeHistory(tx, input.eventId, "manager-remove", actor, { manager: label(person) });
    return {};
  });
}

/**
 * Copies every grant of the old Series to the new Series (a Series split). The manager keeps the
 * old Series too. Writes one history entry on the new Series when there is a grant to copy.
 */
export async function copyGrants(tx: Tx, fromEventId: string, toEventId: string, actor: Actor): Promise<void> {
  const copied = await tx
    .insert(eventManagers)
    .select(
      tx
        .select({
          eventId: sql<string>`${toEventId}::uuid`.as("event_id"),
          editorId: eventManagers.editorId,
          grantedBy: eventManagers.grantedBy,
          grantedAt: eventManagers.grantedAt,
        })
        .from(eventManagers)
        .where(eq(eventManagers.eventId, fromEventId)),
    )
    .onConflictDoNothing()
    .returning({ editorId: eventManagers.editorId });
  if (copied.length === 0) return;
  const names = await tx
    .select({ name: editors.name, email: editors.email })
    .from(eventManagers)
    .innerJoin(editors, eq(editors.id, eventManagers.editorId))
    .where(eq(eventManagers.eventId, toEventId))
    .orderBy(asc(sql`lower(coalesce(${editors.name}, ${editors.email}))`));
  await writeHistory(tx, toEventId, "managers-copied", actor, { managers: names.map(label) });
}

/** The managers of one Event, by name, for the Managers section. */
export async function listManagers(db: Pick<Db, "select">, eventId: string): Promise<ManagerRow[]> {
  const rows = await db
    .select({
      editorId: editors.id,
      name: editors.name,
      email: editors.email,
      role: editors.role,
      deactivatedAt: editors.deactivatedAt,
      emailVerified: editors.emailVerified,
    })
    .from(eventManagers)
    .innerJoin(editors, eq(editors.id, eventManagers.editorId))
    .where(eq(eventManagers.eventId, eventId))
    .orderBy(asc(sql`lower(coalesce(${editors.name}, ${editors.email}))`));
  return rows.map(({ deactivatedAt, emailVerified, ...row }) => ({
    ...row,
    status: statusOf({ deactivatedAt, emailVerified, role: row.role }),
  }));
}

export interface GrantRow {
  eventId: string;
  title: string;
  deleted: boolean;
  reviewStatus: EventRow["reviewStatus"];
}

/** Every Event that an account has a grant for (also Deleted ones, flagged), by title. */
export async function listGrantsOfEditor(db: Pick<Db, "select">, editorId: string): Promise<GrantRow[]> {
  const rows = await db
    .select({
      eventId: events.id,
      title: events.title,
      deletedAt: events.deletedAt,
      reviewStatus: events.reviewStatus,
    })
    .from(eventManagers)
    .innerJoin(events, eq(events.id, eventManagers.eventId))
    .where(eq(eventManagers.editorId, editorId))
    .orderBy(asc(sql`lower(${events.title})`));
  return rows.map(({ deletedAt, ...row }) => ({ ...row, deleted: deletedAt !== null }));
}
