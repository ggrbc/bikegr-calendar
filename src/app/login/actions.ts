"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { googleSignInEnabled, LOGIN_PATH, signIn } from "@/auth";
import { isValidEmail, normalizeEmail } from "@/auth/rules";

/**
 * "Sign in with Google": Auth.js answers with a redirect to Google (it throws Next.js's redirect, so
 * this never returns). Google comes back to `/api/auth/callback/google`; the `signIn` callback
 * admits only an active Editor (src/auth/config.ts). With no Google client, back to the login page.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!googleSignInEnabled()) redirect(LOGIN_PATH);
  await signIn("google", { redirectTo: "/admin" });
}

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
