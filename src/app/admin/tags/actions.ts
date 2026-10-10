"use server";

import { revalidatePath } from "next/cache";
import { mergeTags, renameTag, retireTag, unretireTag, addTag, type TagResult } from "@/admin/tags/tags";
import { parseCalendar } from "@/admin/tags/rules";
import { invalidatePublicEvents } from "@/agenda/cache";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";

export type TagFormState =
  | { result: "idle" }
  | { result: "ok"; message: string }
  | { result: "error"; message: string };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** Tags show in the admin, in the Event pickers, and on the public agenda. */
function revalidateTagPages() {
  for (const path of ["/admin/tags", "/admin/events", "/", "/rides", "/advocacy"]) revalidatePath(path);
  invalidatePublicEvents();
}

function toState<T>(result: TagResult<T>, message: (value: T) => string): TagFormState {
  if (!result.ok) return { result: "error", message: result.error };
  revalidateTagPages();
  return { result: "ok", message: message(result.value) };
}

export async function addTagAction(_prev: TagFormState, formData: FormData): Promise<TagFormState> {
  const editor = await requireEditor();
  const calendar = parseCalendar(formData.get("calendar"));
  if (!calendar) return { result: "error", message: "Select a Calendar." };
  const result = await addTag(getDb(), editor.id, { calendar, name: formData.get("name") });
  return toState(result, (tag) => `Added "${tag.name}" (${tag.slug}).`);
}

/**
 * One action for every control of a Tag row, so the row shows one message: the last one.
 * `intent` is `rename`, `retire`, `unretire`, or `merge`.
 */
export async function tagRowAction(_prev: TagFormState, formData: FormData): Promise<TagFormState> {
  const editor = await requireEditor();
  const db = getDb();
  const tagId = text(formData, "tagId");

  switch (text(formData, "intent")) {
    case "rename": {
      const result = await renameTag(db, editor.id, { tagId, name: formData.get("name") });
      return toState(result, (tag) => `Renamed to "${tag.name}". The slug stays "${tag.slug}".`);
    }
    case "retire": {
      const result = await retireTag(db, editor.id, { tagId });
      return toState(result, (tag) => `Retired "${tag.name}".`);
    }
    case "unretire": {
      const result = await unretireTag(db, editor.id, { tagId });
      return toState(result, (tag) => `"${tag.name}" is active again.`);
    }
    case "merge": {
      const result = await mergeTags(db, editor.id, { sourceId: tagId, targetId: text(formData, "targetId") });
      return toState(
        result,
        ({ moved, duplicates }) =>
          `Merged and retired. ${moved} Event${moved === 1 ? "" : "s"} moved` +
          (duplicates > 0 ? `; ${duplicates} already had the other Tag.` : "."),
      );
    }
    default:
      return { result: "error", message: "Unknown action. Reload the page." };
  }
}
