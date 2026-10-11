"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import {
  deactivateEditor,
  reactivateEditor,
  saveEditor,
  type EditorResult,
} from "@/admin/editors/editors";
import { signIn } from "@/auth";
import { requireAdmin } from "@/auth/dal";
import { inviteEditor } from "@/auth/editors";
import { parseInviteInput } from "@/auth/rules";
import { getDb } from "@/db";
import type { Editor } from "@/db/schema";

/** The list, every edit page, and the header (it shows the name) read Editor rows. */
const revalidateEditorPages = () => revalidatePath("/admin", "layout");

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * React 19 resets a form after its action. An error state carries the posted values, so the form
 * shows them again (as `defaultValue`), and `stamp` changes on each submit, so the form can use it
 * as a `key` and take the new defaults.
 */
export interface InviteValues {
  email: string;
  name: string;
  role: string;
}

export type InviteState =
  | { result: "idle" }
  | { result: "sent"; email: string }
  | { result: "error"; message: string; values: InviteValues; stamp: number };

/** Admin only: creates the Editor, then sends the invite magic link. */
export async function inviteEditorAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const values: InviteValues = { email: text(formData, "email"), name: text(formData, "name"), role: text(formData, "role") };
  const fail = (message: string): InviteState => ({ result: "error", message, values, stamp: Date.now() });

  const parsed = parseInviteInput(values);
  if (!parsed.ok) return fail(parsed.error);

  const result = await inviteEditor(
    getDb(),
    { id: admin.id, role: admin.role, deactivatedAt: null },
    parsed.value,
  );
  if (!result.ok) return fail(result.error);
  revalidateEditorPages();

  try {
    await signIn("resend", { email: result.editor.email, redirect: false, redirectTo: "/admin" });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    console.error("[auth] Invite email failed:", error.type);
    return fail(`${result.editor.email} is now an Editor, but the invite email failed. They can get a link at /login.`);
  }
  return { result: "sent", email: result.editor.email };
}

export interface EditorFormValues {
  name?: string;
  role?: string;
}

export type EditorFormState =
  | { result: "idle" }
  | { result: "ok"; message: string; values?: EditorFormValues; stamp: number }
  | { result: "error"; message: string; values?: EditorFormValues; stamp: number };

const who = (editor: Editor) => editor.name ?? editor.email;

function toState(result: EditorResult<Editor>, message: (editor: Editor) => string): EditorFormState {
  if (!result.ok) return { result: "error", message: result.error, stamp: Date.now() };
  revalidateEditorPages();
  return { result: "ok", message: message(result.value), stamp: Date.now() };
}

/**
 * The edit page's one form: Name, and Role when the form has it. `nameWas` and `roleWas` are what
 * the form showed; `saveEditor` writes only what changed and refuses a stale form. All or nothing.
 */
export async function saveEditorAction(_prev: EditorFormState, formData: FormData): Promise<EditorFormState> {
  const admin = await requireAdmin();
  const hasRole = formData.has("role");
  const values: EditorFormValues = { name: text(formData, "name"), ...(hasRole && { role: text(formData, "role") }) };

  const result = await saveEditor(getDb(), admin.id, {
    editorId: text(formData, "editorId"),
    name: values.name,
    nameWas: text(formData, "nameWas"),
    ...(hasRole && { role: values.role, roleWas: text(formData, "roleWas") }),
  });
  if (!result.ok) return { result: "error", message: result.error, values, stamp: Date.now() };

  revalidateEditorPages();
  const { editor, roleChanged } = result.value;
  const message = roleChanged ? `Saved. ${who(editor)} is now ${editor.role === "admin" ? "an Admin" : "an Editor"}.` : "Saved.";
  return { result: "ok", message, values: { name: editor.name ?? "", role: editor.role }, stamp: Date.now() };
}

/** `intent` is `deactivate` or `reactivate`. */
export async function editorRowAction(_prev: EditorFormState, formData: FormData): Promise<EditorFormState> {
  const admin = await requireAdmin();
  const db = getDb();
  const editorId = text(formData, "editorId");

  switch (text(formData, "intent")) {
    case "deactivate": {
      const result = await deactivateEditor(db, admin.id, { editorId });
      return toState(result, (e) => `${who(e)} is deactivated and signed out.`);
    }
    case "reactivate": {
      const result = await reactivateEditor(db, admin.id, { editorId });
      return toState(result, (e) => `${who(e)} is active again. They can sign in at /login.`);
    }
    default:
      return { result: "error", message: "Unknown action. Reload the page.", stamp: Date.now() };
  }
}
