/**
 * Every admin Event page, the Review queue, the public agenda pages, and the public Calendar cache
 * (the agenda, the Embed, and the Feeds read the cached snapshot). Each successful Event write calls
 * this. Not in actions.ts: a "use server" file can export only async functions.
 */
import { revalidatePath } from "next/cache";
import { invalidatePublicEvents } from "@/agenda/cache";

export function revalidateEvents(): void {
  revalidatePath("/admin/events", "layout");
  revalidatePath("/admin/review");
  revalidatePath("/");
  revalidatePath("/rides");
  revalidatePath("/advocacy");
  invalidatePublicEvents();
}
