"use server";

/**
 * The Event manager's one write: the Schedule status, Schedule note, and Occurrence details of one
 * date. The person comes from the session, never from the form. The change is public at once.
 */
import { revalidatePath } from "next/cache";
import { saveManagerOccurrence } from "@/admin/events/manager-occurrence";
import { todayInDetroit } from "@/agenda/dates";
import { requireEventManager } from "@/auth/dal";
import { getDb } from "@/db";
import type { SaveState } from "../events/actions";
import { revalidateEvents } from "../events/revalidate-events";

export async function saveOccurrenceAction(_prev: SaveState, input: unknown): Promise<SaveState> {
  const me = await requireEventManager();
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const values = typeof raw.values === "object" && raw.values !== null ? (raw.values as Record<string, unknown>) : {};
  const result = await saveManagerOccurrence(
    getDb(),
    { id: me.id, role: me.role },
    { eventId: raw.eventId, originalStart: raw.originalStart, ...values },
    { today: todayInDetroit(new Date()) },
  );
  if (!result.ok) {
    return result.reason === "invalid" || result.reason === "failed"
      ? { status: "invalid", message: result.message, errors: result.reason === "invalid" ? result.errors : {} }
      : { status: "gone", message: result.message };
  }
  revalidateEvents();
  revalidatePath("/admin/my-events", "layout");
  return { status: "saved", message: "Saved. The change is public now." };
}
