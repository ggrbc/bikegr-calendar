"use server";

import { revalidatePath } from "next/cache";
import { mergeTags, renameTag, retireTag, unretireTag, addTag, type TagResult } from "@/admin/tags/tags";
import { parseCalendar } from "@/admin/tags/rules";
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

export async function renameTagAction(_prev: TagFormState, formData: FormData): Promise<TagFormState> {
  const editor = await requireEditor();
  const result = await renameTag(getDb(), editor.id, { tagId: text(formData, "tagId"), name: formData.get("name") });
  return toState(result, (tag) => `Renamed to "${tag.name}". The slug stays "${tag.slug}".`);
}

/** Retires the Tag when the form sends `retire=yes`, else unretires it. */
export async function setTagRetiredAction(_prev: TagFormState, formData: FormData): Promise<TagFormState> {
  const editor = await requireEditor();
  const tagId = text(formData, "tagId");
  if (text(formData, "retire") === "yes") {
    const result = await retireTag(getDb(), editor.id, { tagId });
    return toState(result, (tag) => `Retired "${tag.name}".`);
  }
  const result = await unretireTag(getDb(), editor.id, { tagId });
  return toState(result, (tag) => `"${tag.name}" is active again.`);
}

export async function mergeTagAction(_prev: TagFormState, formData: FormData): Promise<TagFormState> {
  const editor = await requireEditor();
  const result = await mergeTags(getDb(), editor.id, {
    sourceId: text(formData, "tagId"),
    targetId: text(formData, "targetId"),
  });
  return toState(result, ({ moved, duplicates }) =>
    `Merged. ${moved} Event${moved === 1 ? "" : "s"} moved` +
    (duplicates > 0 ? `; ${duplicates} already had the other Tag.` : "."),
  );
}
