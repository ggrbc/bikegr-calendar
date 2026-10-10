/**
 * Auth.js for the app. The config itself is in ./config.ts.
 *
 * The config is lazy (`NextAuth((req) => …)`): nothing reads the database or the mail settings until
 * a request comes, so `next build` needs no database.
 */
import NextAuth from "next-auth";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { clientIp } from "@/rate-limit";
import { buildAuthConfig } from "./config";
import { googleCredentials } from "./google";
import { createMailer } from "./mailer";

export { LOGIN_PATH } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth((req) =>
  buildAuthConfig({
    db: getDb(),
    mailer: createMailer(),
    // The route handler gives `req`. A server action's `signIn()` (login, invite) gives none, but it
    // runs in the browser's request, so `headers()` has the same headers. Read only at a link request.
    getClientIp: async () => clientIp(req ? req.headers : await headers()),
    google: googleCredentials(process.env),
  }),
);

/** True when Google sign-in is configured. The login page shows the Google button only then. */
export function googleSignInEnabled(): boolean {
  return googleCredentials(process.env) !== null;
}
