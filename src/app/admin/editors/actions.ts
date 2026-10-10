"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { changeEditorRole, deactivateEditor, reactivateEditor, type EditorResult } from "@/admin/editors/editors";
import { parseRole } from "@/admin/editors/rules";
import { signIn } from "@/auth";
import { requireAdmin } from "@/auth/dal";
import { inviteEditor } from "@/auth/editors";
import { parseInviteInput } from "@/auth/rules";
import { getDb } from "@/db";
import type { Editor } from "@/db/schema";

export type InviteState =
  | { result: "idle" }
  | { result: "sent"; email: string }
  | { result: "error"; message: string };

/** Admin only: creates the Editor, then sends the invite magic link. */
export async function inviteEditorAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin();

  const parsed = parseInviteInput({
    email: formData.get("email"),
    role: formData.get("role"),
    name: formData.get("name"),
  });
  if (!parsed.ok) return { result: "error", message: parsed.error };

  const result = await inviteEditor(
    getDb(),
    { id: admin.id, role: admin.role, deactivatedAt: null },
    parsed.value,
  );
  if (!result.ok) return { result: "error", message: result.error };
  revalidatePath("/admin/editors");

  try {
    await signIn("resend", { email: result.editor.email, redirect: false, redirectTo: "/admin" });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    console.error("[auth] Invite email failed:", error.type);
    return {
      result: "error",
      message: `${result.editor.email} is now an Editor, but the invite email failed. They can get a link at /login.`,
    };
  }
  return { result: "sent", email: result.editor.email };
}

export type EditorFormState =
  | { result: "idle" }
  | { result: "ok"; message: string }
  | { result: "error"; message: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const who = (editor: Editor) => editor.name ?? editor.email;

function toState(result: EditorResult<Editor>, message: (editor: Editor) => string): EditorFormState {
  if (!result.ok) return { result: "error", message: result.error };
  revalidatePath("/admin/editors");
  return { result: "ok", message: message(result.value) };
}

/**
 * One action for every control of an Editor row, so the row shows one message: the last one.
 * `intent` is `role`, `deactivate`, or `reactivate`.
 */
export async function editorRowAction(_prev: EditorFormState, formData: FormData): Promise<EditorFormState> {
  const admin = await requireAdmin();
  const db = getDb();
  const editorId = text(formData, "editorId");

  switch (text(formData, "intent")) {
    case "role": {
      const role = parseRole(formData.get("role"));
      if (!role) return { result: "error", message: "Select a role: Admin or Editor." };
      const result = await changeEditorRole(db, admin.id, { editorId, role });
      return toState(result, (e) => `${who(e)} is now ${e.role === "admin" ? "an Admin" : "an Editor"}.`);
    }
    case "deactivate": {
      const result = await deactivateEditor(db, admin.id, { editorId });
      return toState(result, (e) => `${who(e)} is deactivated and signed out.`);
    }
    case "reactivate": {
      const result = await reactivateEditor(db, admin.id, { editorId });
      return toState(result, (e) => `${who(e)} is active again. They can sign in at /login.`);
    }
    default:
      return { result: "error", message: "Unknown action. Reload the page." };
  }
}
