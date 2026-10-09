/**
 * Auth.js for the app. The config itself is in ./config.ts.
 *
 * The config is lazy (`NextAuth(() => …)`): nothing reads the database or the mail settings until a
 * request comes, so `next build` needs no database.
 */
import NextAuth from "next-auth";
import { getDb } from "@/db";
import { buildAuthConfig } from "./config";
import { createMailer } from "./mailer";

export { LOGIN_PATH } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(() =>
  buildAuthConfig({ db: getDb(), mailer: createMailer() }),
);
