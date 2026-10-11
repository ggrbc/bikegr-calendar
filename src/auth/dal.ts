/**
 * Data Access Layer for auth. Every admin page and every server action calls one of these; a
 * hidden form is not a check.
 */
import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db";
import type { EditorRole } from "@/db/schema";
import { findEditorById } from "./editors";
import { LOGIN_PATH, auth } from "./index";
import { type Need, accessRedirect } from "./access";
import { canSignIn } from "./rules";

export interface CurrentEditor {
  id: string;
  email: string;
  name: string | null;
  role: EditorRole;
}

/**
 * The logged-in, active Editor, or null. Reads the session and the Editor row on every request, so
 * a deactivation takes effect at once.
 *
 * `connection()` first: with `partialPrefetching`, Next.js prerenders the admin shells with the real
 * cookies, and `auth()` makes a CSRF token with `crypto.getRandomValues()` on every call. That is an
 * unstable value in a prerender, so the session read must wait for the request.
 */
export const getCurrentEditor = cache(async (): Promise<CurrentEditor | null> => {
  await connection();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const editor = await findEditorById(getDb(), id);
  if (!editor || !canSignIn(editor)) return null;
  return { id: editor.id, email: editor.email, name: editor.name, role: editor.role };
});

async function require(need: Need): Promise<CurrentEditor> {
  const editor = await getCurrentEditor();
  if (!editor) redirect(LOGIN_PATH);
  const away = accessRedirect(editor.role, need);
  if (away) redirect(away);
  return editor;
}

/** Any active account, of any role: the account page and the admin shell. */
export const requireSignedIn = () => require("signed-in");

/**
 * An active Editor or Admin. An Event manager is sent to My Events. Every Editor page and server
 * action calls this (or `requireAdmin`), so the Event manager role is refused by default
 * (src/auth/access.test.ts checks that each one does).
 */
export const requireEditor = () => require("editor");

export const requireAdmin = () => require("admin");

/** An active Event manager: the My Events pages. */
export const requireEventManager = () => require("event-manager");
