"use server";

/**
 * Thin server actions for the admin Event pages: check the Editor, parse the untrusted input, call
 * the write module, then revalidate. Domain rules live in src/admin/events.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type CurrentEditor, requireAdmin, requireEditor } from "@/auth/dal";
import { createEvent } from "@/admin/events/create-event";
import { deleteEvent, restoreEvent } from "@/admin/events/delete-event";
import { editOneTimeEvent, editSeriesContent } from "@/admin/events/edit-event";
import {
  type FieldErrors,
  type ParseContext,
  parseEventInput,
  parseOverrideInput,
  parseSeriesContentInput,
  parseSplitInput,
} from "@/admin/events/event-input";
import { NOT_FOUND_MESSAGE } from "@/admin/events/format";
import { clearOverride, saveOverride } from "@/admin/events/overrides";
import { loadEventForEdit } from "@/admin/events/queries";
import { splitSeries } from "@/admin/events/split-series";
import type { WriteFailure } from "@/admin/events/write-helpers";
import { isEventImageUrl } from "@/admin/images/image-url";
import { getDb } from "@/db";

export type SaveState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "invalid"; message: string; errors: FieldErrors }
  | { status: "conflict"; message: string }
  | { status: "gone"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Target {
  id: string;
  version: number;
}

function record(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function parseTarget(input: unknown): Target | null {
  const { id, version } = record(input);
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  return { id, version };
}

const BAD_REQUEST: SaveState = { status: "gone", message: NOT_FOUND_MESSAGE };

function fromFailure(failure: WriteFailure): SaveState {
  switch (failure.reason) {
    case "conflict":
      return { status: "conflict", message: failure.message };
    case "invalid":
      return { status: "invalid", message: failure.message, errors: failure.errors };
    default:
      return { status: "gone", message: failure.message };
  }
}

function invalidState(errors: FieldErrors): SaveState {
  return { status: "invalid", message: "Check the marked fields.", errors };
}

function context(editor: CurrentEditor, storedImageUrl: string | null): ParseContext {
  return { isAdmin: editor.role === "admin", storedImageUrl, isImageUrl: (url) => isEventImageUrl(url) };
}

const actor = (editor: CurrentEditor) => ({ id: editor.id, role: editor.role });

/** Every admin Event page, and the public agenda pages. */
function revalidateEvents(): void {
  revalidatePath("/admin/events", "layout");
  revalidatePath("/");
  revalidatePath("/rides");
  revalidatePath("/advocacy");
}

export async function createEventAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const parsed = parseEventInput(record(input).values, context(editor, null));
  if (!parsed.ok) return invalidState(parsed.errors);
  const result = await createEvent(getDb(), actor(editor), parsed.value);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  redirect(`/admin/events/${result.id}?saved=created`);
}

/** Edit in place: `scope` "all" (a Series: content only) or "one-time" (every field). */
export async function saveEventAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const target = parseTarget(input);
  if (!target) return BAD_REQUEST;
  const db = getDb();
  const event = await loadEventForEdit(db, target.id);
  if (!event) return BAD_REQUEST;
  const ctx = context(editor, event.row.imageUrl);
  const { values, scope } = record(input);

  let result;
  if (scope === "all") {
    const parsed = parseSeriesContentInput(values, ctx);
    if (!parsed.ok) return invalidState(parsed.errors);
    result = await editSeriesContent(db, actor(editor), target, parsed.value);
  } else {
    const parsed = parseEventInput(values, ctx);
    if (!parsed.ok) return invalidState(parsed.errors);
    result = await editOneTimeEvent(db, actor(editor), target, parsed.value);
  }
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  return { status: "saved", message: "Saved." };
}

/** "This date and later": a Series split, a change in place, or a stop. */
export async function splitSeriesAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const target = parseTarget(input);
  if (!target) return BAD_REQUEST;
  const db = getDb();
  const event = await loadEventForEdit(db, target.id);
  if (!event) return BAD_REQUEST;
  const parsed = parseSplitInput(record(input).values, context(editor, event.row.imageUrl));
  if (!parsed.ok) return invalidState(parsed.errors);
  const result = await splitSeries(db, actor(editor), target, parsed.value);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  if (result.kind === "split") redirect(`/admin/events/${result.id}?saved=split`);
  return {
    status: "saved",
    message: result.kind === "stop" ? "Saved. The Series stops before that date." : "Saved.",
  };
}

export async function saveOverrideAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const target = parseTarget(input);
  if (!target) return BAD_REQUEST;
  const db = getDb();
  const event = await loadEventForEdit(db, target.id);
  if (!event) return BAD_REQUEST;
  const parsed = parseOverrideInput(record(input).values, event.row.allDay);
  if (!parsed.ok) return invalidState(parsed.errors);
  const result = await saveOverride(db, actor(editor), target, parsed.value);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  return { status: "saved", message: "Saved the change to this date." };
}

export async function clearOverrideAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const target = parseTarget(input);
  const { originalStart } = record(input);
  if (!target || typeof originalStart !== "string") return BAD_REQUEST;
  const result = await clearOverride(getDb(), actor(editor), target, originalStart);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  return { status: "saved", message: "This date is the same as the Series again." };
}

export async function deleteEventAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const editor = await requireEditor();
  const target = parseTarget(input);
  if (!target) return BAD_REQUEST;
  const result = await deleteEvent(getDb(), actor(editor), target);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  return { status: "saved", message: "Deleted. The Event is hidden everywhere. An Admin can restore it." };
}

export async function restoreEventAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const admin = await requireAdmin();
  const target = parseTarget(input);
  if (!target) return BAD_REQUEST;
  const result = await restoreEvent(getDb(), actor(admin), target);
  if (!result.ok) return fromFailure(result);
  revalidateEvents();
  return { status: "saved", message: "Restored." };
}
