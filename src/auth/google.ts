/**
 * Pure rules for Google sign-in (docs/plans/google-login.md). No database, no Next.js.
 *
 * The input is the Google ID token claims, as Auth.js gives them to the `signIn` callback
 * (`profile`). Only a few claims matter here.
 */
import { isValidEmail, normalizeEmail } from "./rules";

export const GOOGLE_PROVIDER_ID = "google";

/** The Google ID token claims that the sign-in rules read. Other claims are ignored. */
export interface GoogleClaims {
  email?: unknown;
  email_verified?: unknown;
  /** The Workspace domain of the account. Google sets it only for Workspace accounts. */
  hd?: unknown;
}

/**
 * The normalized email of a Google account, or null. Null when Google did not verify the email
 * (only the boolean `true` counts) or when the email is not valid.
 */
export function googleSignInEmail(claims: GoogleClaims): string | null {
  if (claims.email_verified !== true || typeof claims.email !== "string") return null;
  const email = normalizeEmail(claims.email);
  return isValidEmail(email) ? email : null;
}

/**
 * True when Google is authoritative for the account's email, so `email_verified` proves that the
 * person controls the address (Google's own rule): a Gmail address with no `hd`, or a Workspace
 * account whose `hd` equals its email domain. A Google account made on another provider's address
 * (for example `x@yahoo.com`) is false: Google checked that address once, but does not own it.
 */
export function isGoogleAuthoritative(claims: GoogleClaims): boolean {
  if (typeof claims.email !== "string") return false;
  const email = normalizeEmail(claims.email);
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (typeof claims.hd === "string" && claims.hd !== "") {
    return normalizeEmail(claims.hd) === domain;
  }
  return domain === "gmail.com";
}
