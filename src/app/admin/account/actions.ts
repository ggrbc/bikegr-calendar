"use server";

import { revalidatePath } from "next/cache";
import { renameEditor } from "@/admin/editors/editors";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import type { EditorFormState } from "../editors/actions";

/** Any signed-in person changes their own name. The id is the session's, never from the form. */
export async function saveOwnNameAction(_prev: EditorFormState, formData: FormData): Promise<EditorFormState> {
  const me = await requireEditor();
  const result = await renameEditor(getDb(), me.id, { editorId: me.id, name: formData.get("name") });
  if (!result.ok) return { result: "error", message: result.error };
  revalidatePath("/admin", "layout"); // The header shows the name.
  return { result: "ok", message: "Saved." };
}
