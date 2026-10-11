/**
 * Editor management (design.md, "Editors"): role change, rename, deactivate, reactivate, and the
 * Admin list. Callers pass the database, so tests can use PGlite. Never hard-deletes an Editor.
 *
 * Concurrency: every write here starts with one transaction-scoped advisory lock, so these writes
 * run one at a time. Postgres runs in READ COMMITTED, so each statement after the lock sees what
 * the earlier write committed. Without the lock, two Admins who demote each other at the same time
 * would each see two Admins, and both would commit: zero Admins.
 */
import { and, asc, count, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authSessions, authVerificationTokens, editors, type Editor, type EditorRole } from "@/db/schema";
import type { Db } from "@/db/types";
import { parseEditorName } from "@/auth/rules";
import {
  checkDeactivate,
  checkReactivate,
  checkRename,
  checkRoleChange,
  parseRole,
  type EditorRefusal,
} from "./rules";

export type EditorResult<T> = { ok: true; value: T } | ({ ok: false } & EditorRefusal);

/** One fixed key for all Editor role and activation writes ("editor" in ASCII, as hex). */
const EDITOR_WRITES_LOCK = 0x656469746f72;

/** Auth.js's default database-session `maxAge` (src/auth/config.ts does not change it). */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const NOT_FOUND: { ok: false } & EditorRefusal = {
  ok: false,
  reason: "not-found",
  error: "This Editor does not exist. Reload the page.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Takes the lock, then reads the actor and the target. */
async function lockAndRead(tx: Tx, actorId: string, editorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(EDITOR_WRITES_LOCK))})`);
  const [actor] = await tx.select().from(editors).where(eq(editors.id, actorId));
  const [target] = await tx.select().from(editors).where(eq(editors.id, editorId));
  return { actor, target };
}

/** Call after `lockAndRead`, only for the rules that need it. */
async function countActiveAdmins(tx: Tx): Promise<number> {
  const [{ activeAdmins }] = await tx
    .select({ activeAdmins: count() })
    .from(editors)
    .where(and(eq(editors.role, "admin"), isNull(editors.deactivatedAt)));
  return activeAdmins;
}

const STALE: EditorRefusal = {
  reason: "stale",
  error: "Another Admin changed this Editor. Reload the page.",
};

const refused = (refusal: EditorRefusal) => ({ ok: false, ...refusal }) as const;

export async function changeEditorRole(
  db: Db,
  actorId: string,
  input: { editorId: string; role: EditorRole },
): Promise<EditorResult<Editor>> {
  if (!UUID.test(input.editorId) || !UUID.test(actorId)) return NOT_FOUND;
  return db.transaction(async (tx) => {
    const { actor, target } = await lockAndRead(tx, actorId, input.editorId);
    if (!actor) return refused({ reason: "not-admin", error: "Only an active Admin can manage Editors." });
    if (!target) return NOT_FOUND;
    const activeAdmins = await countActiveAdmins(tx);
    const refusal = checkRoleChange({ actor, target, role: input.role, activeAdmins });
    if (refusal) return refused(refusal);
    if (target.role === input.role) return { ok: true, value: target } as const;

    const [updated] = await tx.update(editors).set({ role: input.role }).where(eq(editors.id, target.id)).returning();
    return { ok: true, value: updated } as const;
  });
}

/**
 * Renames an Editor. An active Admin renames anyone; any other active person renames only
 * themselves (checkRename). The name is required (parseEditorName).
 */
export async function renameEditor(
  db: Db,
  actorId: string,
  input: { editorId: string; name: unknown },
): Promise<EditorResult<Editor>> {
  if (!UUID.test(input.editorId) || !UUID.test(actorId)) return NOT_FOUND;
  const name = parseEditorName(input.name);
  if (!name.ok) return refused({ reason: "invalid", error: name.error });
  return db.transaction(async (tx) => {
    const { actor, target } = await lockAndRead(tx, actorId, input.editorId);
    if (!actor) return refused({ reason: "not-allowed", error: "You cannot change names." });
    if (!target) return NOT_FOUND;
    const refusal = checkRename({ actor, target });
    if (refusal) return refused(refusal);

    const [updated] = await tx
      .update(editors)
      .set({ name: name.value })
      .where(eq(editors.id, target.id))
      .returning();
    return { ok: true, value: updated } as const;
  });
}

export interface SaveEditorInput {
  editorId: string;
  /** The posted name, and the name the form showed (what the page loaded with; "" for none). */
  name: unknown;
  nameWas: string;
  /** The posted role and the role the form showed. Both are absent when the form has no Role. */
  role?: unknown;
  roleWas?: unknown;
}

/**
 * The edit page's Save: name and role in one lock and one transaction, all or nothing. A field is
 * written only when the posted value differs from its `*Was` value (what the form showed). And then
 * the stored value must still be the `*Was` value: if not, another Admin (or the person) changed it
 * since the page loaded, and the whole save is refused, so a stale form never undoes a change.
 */
export async function saveEditor(
  db: Db,
  actorId: string,
  input: SaveEditorInput,
): Promise<EditorResult<{ editor: Editor; nameChanged: boolean; roleChanged: boolean }>> {
  if (!UUID.test(input.editorId) || !UUID.test(actorId)) return NOT_FOUND;
  const name = parseEditorName(input.name);
  if (!name.ok) return refused({ reason: "invalid", error: name.error });
  const hasRole = input.role !== undefined;
  const role = hasRole ? parseRole(input.role) : null;
  const roleWas = hasRole ? parseRole(input.roleWas) : null;
  if (hasRole && (!role || !roleWas)) return refused({ reason: "invalid", error: "Select a role: Admin or Editor." });

  return db.transaction(async (tx) => {
    const { actor, target } = await lockAndRead(tx, actorId, input.editorId);
    if (!actor) return refused({ reason: "not-allowed", error: "You cannot change names." });
    if (!target) return NOT_FOUND;

    const nameChanged = name.value !== input.nameWas;
    const roleChanged = role !== null && role !== roleWas;
    if (!nameChanged && !roleChanged) return { ok: true, value: { editor: target, nameChanged, roleChanged } } as const;
    if (nameChanged && (target.name ?? "") !== input.nameWas) return refused(STALE);
    if (roleChanged && target.role !== roleWas) return refused(STALE);

    // Every check runs before the first write.
    if (nameChanged) {
      const refusal = checkRename({ actor, target });
      if (refusal) return refused(refusal);
    }
    if (roleChanged) {
      const refusal = checkRoleChange({ actor, target, role, activeAdmins: await countActiveAdmins(tx) });
      if (refusal) return refused(refusal);
    }

    const [updated] = await tx
      .update(editors)
      .set({ ...(nameChanged && { name: name.value }), ...(roleChanged && { role }) })
      .where(eq(editors.id, target.id))
      .returning();
    return { ok: true, value: { editor: updated, nameChanged, roleChanged } } as const;
  });
}

/**
 * Deactivates an Editor: sets `deactivated_at/by`, deletes their sessions (access stops at once),
 * and deletes their unused magic links. The row stays, so audit trails keep the name.
 */
export async function deactivateEditor(
  db: Db,
  actorId: string,
  input: { editorId: string },
): Promise<EditorResult<Editor>> {
  if (!UUID.test(input.editorId) || !UUID.test(actorId)) return NOT_FOUND;
  return db.transaction(async (tx) => {
    const { actor, target } = await lockAndRead(tx, actorId, input.editorId);
    if (!actor) return refused({ reason: "not-admin", error: "Only an active Admin can manage Editors." });
    if (!target) return NOT_FOUND;
    const activeAdmins = await countActiveAdmins(tx);
    const refusal = checkDeactivate({ actor, target, activeAdmins });
    if (refusal) return refused(refusal);

    const [updated] = await tx
      .update(editors)
      .set({ deactivatedAt: new Date(), deactivatedBy: actor.id })
      .where(eq(editors.id, target.id))
      .returning();
    await tx.delete(authSessions).where(eq(authSessions.userId, target.id));
    await tx.delete(authVerificationTokens).where(eq(authVerificationTokens.identifier, target.email));
    return { ok: true, value: updated } as const;
  });
}

/** Reactivates an Editor. The role stays as it was; they sign in again at /login. */
export async function reactivateEditor(
  db: Db,
  actorId: string,
  input: { editorId: string },
): Promise<EditorResult<Editor>> {
  if (!UUID.test(input.editorId) || !UUID.test(actorId)) return NOT_FOUND;
  return db.transaction(async (tx) => {
    const { actor, target } = await lockAndRead(tx, actorId, input.editorId);
    if (!actor) return refused({ reason: "not-admin", error: "Only an active Admin can manage Editors." });
    if (!target) return NOT_FOUND;
    const refusal = checkReactivate({ actor, target });
    if (refusal) return refused(refusal);

    const [updated] = await tx
      .update(editors)
      .set({ deactivatedAt: null, deactivatedBy: null })
      .where(eq(editors.id, target.id))
      .returning();
    return { ok: true, value: updated } as const;
  });
}

export interface AdminEditorRow {
  id: string;
  email: string;
  name: string | null;
  role: EditorRole;
  invitedAt: Date | null;
  /** Null when no inviter is stored (a seeded Admin). */
  invitedByName: string | null;
  deactivatedAt: Date | null;
  deactivatedByName: string | null;
  /** `email_verified`: Auth.js sets it on the first login. */
  firstSignIn: Date | null;
  /**
   * About when the Editor last used the admin: the latest session expiry minus the session
   * `maxAge`. Auth.js moves the expiry at most once a day, so this is correct to one day. Null
   * when the Editor has no session row.
   */
  lastActive: Date | null;
}

/** The Admin view of Editors: the list, or one Editor when `only` is an id. */
async function selectEditorsForAdmin(db: Db, only?: string): Promise<AdminEditorRow[]> {
  const inviter = alias(editors, "inviter");
  const deactivator = alias(editors, "deactivator");
  const latestSession = db
    .select({ userId: authSessions.userId, expires: max(authSessions.expires).as("latest_expires") })
    .from(authSessions)
    .groupBy(authSessions.userId)
    .as("latest_session");

  const rows = await db
    .select({
      id: editors.id,
      email: editors.email,
      name: editors.name,
      role: editors.role,
      invitedAt: editors.invitedAt,
      invitedByName: sql<string | null>`coalesce(${inviter.name}, ${inviter.email})`,
      deactivatedAt: editors.deactivatedAt,
      deactivatedByName: sql<string | null>`coalesce(${deactivator.name}, ${deactivator.email})`,
      firstSignIn: editors.emailVerified,
      latestExpires: latestSession.expires,
    })
    .from(editors)
    .leftJoin(inviter, eq(inviter.id, editors.invitedBy))
    .leftJoin(deactivator, eq(deactivator.id, editors.deactivatedBy))
    .leftJoin(latestSession, eq(latestSession.userId, editors.id))
    .where(only === undefined ? undefined : eq(editors.id, only))
    .orderBy(asc(isNotNull(editors.deactivatedAt)), asc(sql`lower(coalesce(${editors.name}, ${editors.email}))`));

  return rows.map(({ latestExpires, ...row }) => ({
    ...row,
    lastActive: latestExpires ? new Date(toDate(latestExpires).getTime() - SESSION_MAX_AGE_MS) : null,
  }));
}

export const listEditorsForAdmin = (db: Db) => selectEditorsForAdmin(db);

/** One Editor with the same details as a list row, or null for an unknown or malformed id. */
export async function getEditorForAdmin(db: Db, editorId: string): Promise<AdminEditorRow | null> {
  if (!UUID.test(editorId)) return null;
  const [row] = await selectEditorsForAdmin(db, editorId);
  return row ?? null;
}

/** An aggregate in a subquery can come back as a string with some drivers. */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
