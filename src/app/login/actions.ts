"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { isValidEmail, normalizeEmail } from "@/auth/rules";

export type LoginState =
  | { result: "idle" }
  | { result: "sent"; email: string }
  | { result: "error"; message: string };

/**
 * Asks Auth.js for a magic link. A refused email (not invited, or deactivated) gets the same
 * answer as a sent link, so the page does not show who is an Editor.
 */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isValidEmail(email)) return { result: "error", message: "Enter a valid email address." };

  try {
    await signIn("resend", { email, redirect: false, redirectTo: "/admin" });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.type !== "AccessDenied") {
      console.error("[auth] Magic link failed:", error.type);
      return { result: "error", message: "We could not send the link. Try again later." };
    }
  }
  return { result: "sent", email };
}
