"use server";

/**
 * The Managers section of the Event edit page. Any Editor or Admin adds and removes Event managers.
 * A new person gets the normal invite (a magic link); an existing Event manager gets a short email
 * with a sign-in link. A mail error never undoes the grant.
 */
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { addManager, removeManager } from "@/admin/events/managers";
import { signIn } from "@/auth";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appOrigin, notifyManagerGranted } from "@/email/notify";
import { createEmailTransport } from "@/email/transport";

export type ManagerFormState =
  | { result: "idle" }
  | { result: "ok"; message: string; stamp: number }
  | { result: "error"; message: string; values?: { email: string; name: string }; stamp: number };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addManagerAction(_prev: ManagerFormState, formData: FormData): Promise<ManagerFormState> {
  const editor = await requireEditor();
  const eventId = text(formData, "eventId");
  const values = { email: text(formData, "email"), name: text(formData, "name") };
  const fail = (message: string): ManagerFormState => ({ result: "error", message, values, stamp: Date.now() });
  if (!UUID.test(eventId)) return fail("This Event does not exist.");

  const db = getDb();
  const result = await addManager(db, { id: editor.id, role: editor.role }, { eventId, ...values });
  if (!result.ok) {
    const fieldError = result.reason === "invalid" ? Object.values(result.errors)[0] : undefined;
    return fail(fieldError ?? result.message);
  }
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/editors", "layout");

  const who = result.editor.name ?? result.editor.email;
  if (result.kind === "already") return { result: "ok", message: `${who} already manages this Event.`, stamp: Date.now() };

  if (result.kind === "invited") {
    try {
      await signIn("resend", { email: result.editor.email, redirect: false, redirectTo: "/admin" });
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      console.error("[auth] Manager invite email failed:", error.type);
      return {
        result: "ok",
        message: `${who} is added, but the invite email failed. They can get a link at /login.`,
        stamp: Date.now(),
      };
    }
    return { result: "ok", message: `${who} is added. The invite is sent to ${result.editor.email}.`, stamp: Date.now() };
  }

  const [event] = await db.select({ title: events.title }).from(events).where(eq(events.id, eventId));
  const title = event?.title ?? "an Event";
  let sent = false;
  try {
    // A transport that cannot be made (a bad setting) counts as an email that did not send.
    sent = await notifyManagerGranted(createEmailTransport(), { to: result.editor.email, title }, appOrigin());
  } catch (error) {
    console.error("[email] manager-grant failed:", error instanceof Error ? error.constructor.name : typeof error);
  }
  return {
    result: "ok",
    message: sent
      ? `${who} can now manage ${title}. They got an email with a sign-in link.`
      : `${who} can now manage ${title}. The email did not send.`,
    stamp: Date.now(),
  };
}

export async function removeManagerAction(_prev: ManagerFormState, formData: FormData): Promise<ManagerFormState> {
  const editor = await requireEditor();
  const eventId = text(formData, "eventId");
  const editorId = text(formData, "editorId");
  if (!UUID.test(eventId) || !UUID.test(editorId)) {
    return { result: "error", message: "This manager does not exist. Reload the page.", stamp: Date.now() };
  }
  const result = await removeManager(getDb(), { id: editor.id, role: editor.role }, { eventId, editorId });
  if (!result.ok) return { result: "error", message: result.message, stamp: Date.now() };
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/editors", "layout");
  return { result: "ok", message: "Removed.", stamp: Date.now() };
}
