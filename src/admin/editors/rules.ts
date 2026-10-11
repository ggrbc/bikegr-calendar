/**
 * Pure Editor-management rules (design.md, "Editors"). No database, no Next.js. The callers in
 * ./editors.ts read the facts inside a locked transaction and pass them here.
 */
import { EDITOR_ROLES, type Editor, type EditorRole } from "@/db/schema";
import { canInvite } from "@/auth/rules";

export type EditorFacts = Pick<Editor, "id" | "role" | "deactivatedAt">;

export type EditorRefusalReason =
  | "not-admin"
  | "not-allowed"
  | "self"
  | "last-admin"
  | "deactivated"
  | "not-deactivated"
  | "not-found"
  | "invalid";

export interface EditorRefusal {
  reason: EditorRefusalReason;
  error: string;
}

const NOT_ADMIN: EditorRefusal = { reason: "not-admin", error: "Only an active Admin can manage Editors." };
const LAST_ADMIN: EditorRefusal = {
  reason: "last-admin",
  error: "This is the last active Admin. Make another Editor an Admin first.",
};

/** The display label of each role. A new role adds one entry here. */
export const ROLE_LABELS: Record<EditorRole, string> = { admin: "Admin", editor: "Editor" };

const isActiveAdmin = (editor: EditorFacts) => canInvite(editor);

export function parseRole(raw: unknown): EditorRole | null {
  return typeof raw === "string" && (EDITOR_ROLES as readonly string[]).includes(raw) ? (raw as EditorRole) : null;
}

/** `activeAdmins` is the count of active Admins before the change, the actor included. */
export function checkRoleChange(facts: {
  actor: EditorFacts;
  target: EditorFacts;
  role: EditorRole;
  activeAdmins: number;
}): EditorRefusal | null {
  const { actor, target, role, activeAdmins } = facts;
  if (!isActiveAdmin(actor)) return NOT_ADMIN;
  if (actor.id === target.id) return { reason: "self", error: "You cannot change your own role." };
  if (target.deactivatedAt) {
    return { reason: "deactivated", error: "This Editor is deactivated. Reactivate them first." };
  }
  if (isActiveAdmin(target) && role !== "admin" && activeAdmins <= 1) return LAST_ADMIN;
  return null;
}

export function checkDeactivate(facts: {
  actor: EditorFacts;
  target: EditorFacts;
  activeAdmins: number;
}): EditorRefusal | null {
  const { actor, target, activeAdmins } = facts;
  if (!isActiveAdmin(actor)) return NOT_ADMIN;
  if (actor.id === target.id) return { reason: "self", error: "You cannot deactivate yourself." };
  if (target.deactivatedAt) return { reason: "deactivated", error: "This Editor is already deactivated." };
  if (isActiveAdmin(target) && activeAdmins <= 1) return LAST_ADMIN;
  return null;
}

export function checkReactivate(facts: { actor: EditorFacts; target: EditorFacts }): EditorRefusal | null {
  const { actor, target } = facts;
  if (!isActiveAdmin(actor)) return NOT_ADMIN;
  if (!target.deactivatedAt) return { reason: "not-deactivated", error: "This Editor is already active." };
  return null;
}

/** An active Admin renames anyone. Any other active person renames only themselves. */
export function checkRename(facts: { actor: EditorFacts; target: EditorFacts }): EditorRefusal | null {
  const { actor, target } = facts;
  if (actor.deactivatedAt) {
    return { reason: "not-allowed", error: "Your account is deactivated. You cannot change names." };
  }
  if (isActiveAdmin(actor) || actor.id === target.id) return null;
  return { reason: "not-allowed", error: "You can change only your own name." };
}
