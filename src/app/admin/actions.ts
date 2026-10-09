"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { requireAdmin } from "@/auth/dal";
import { inviteEditor } from "@/auth/editors";
import { parseInviteInput } from "@/auth/rules";
import { getDb } from "@/db";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

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
