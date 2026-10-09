/**
 * Auth.js: invite-only magic-link login with database sessions.
 *
 * The config is lazy (`NextAuth(() => …)`): it runs per request, so `next build` needs no database
 * and each request uses the request's own database Pool.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { getDb } from "@/db";
import { authAccounts, authSessions, authVerificationTokens, editors } from "@/db/schema";
import { findEditorByEmail } from "./editors";
import { createMailer, magicLinkKind } from "./mailer";
import { canSignIn, normalizeEmail } from "./rules";

export const LOGIN_PATH = "/login";

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb();
  return {
    adapter: DrizzleAdapter(db, {
      usersTable: editors,
      accountsTable: authAccounts,
      sessionsTable: authSessions,
      verificationTokensTable: authVerificationTokens,
    }),
    session: { strategy: "database" },
    pages: { signIn: LOGIN_PATH, verifyRequest: LOGIN_PATH, error: LOGIN_PATH },
    providers: [
      Resend({
        // The key is read by our mailer, not by the provider. The provider needs a value.
        apiKey: process.env.RESEND_API_KEY || "console",
        from: process.env.EMAIL_FROM,
        normalizeIdentifier: normalizeEmail,
        async sendVerificationRequest({ identifier, url }) {
          const editor = await findEditorByEmail(db, identifier);
          // The signIn callback already refused unknown emails; this is a second guard.
          if (!canSignIn(editor)) throw new Error("Refused to send a magic link to a non-Editor.");
          await createMailer().sendMagicLink({
            to: identifier,
            url,
            kind: magicLinkKind(editor!),
            loginUrl: new URL(LOGIN_PATH, url).toString(),
          });
        },
      }),
    ],
    callbacks: {
      /**
       * Runs before Auth.js makes a token and sends the email, and again when the link is used.
       * Only an invited, active Editor gets through. A refusal sends no email.
       */
      async signIn({ user }) {
        const editor = user.email ? await findEditorByEmail(db, user.email) : null;
        if (canSignIn(editor)) return true;
        console.warn("[auth] Refused sign-in: not an active Editor.");
        return false;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
});
