/**
 * The Auth.js config: invite-only magic-link login with database sessions. No Next.js imports, so
 * the integration test can run it with the plain `Auth()` handler on PGlite.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { AuthConfig } from "@auth/core";
import { AuthError } from "@auth/core/errors";
import Resend from "@auth/core/providers/resend";
import { authAccounts, authSessions, authVerificationTokens, editors } from "@/db/schema";
import type { Db } from "@/db/types";
import { findEditorByEmail } from "./editors";
import { magicLinkKind, type Mailer } from "./mailer";
import { canSignIn, isValidEmail, normalizeEmail } from "./rules";

export const LOGIN_PATH = "/login";

/** Where Auth.js sends the browser after it sends a magic link. */
const VERIFY_REQUEST_PATH = "/api/auth/verify-request?provider=resend&type=email";

const EXPECTED_ERRORS =new Set<string>(["AccessDenied", "Verification"]);

export function buildAuthConfig({ db, mailer }: { db: Db; mailer: Mailer }): AuthConfig {
  return {
    adapter: DrizzleAdapter(db, {
      usersTable: editors,
      accountsTable: authAccounts,
      sessionsTable: authSessions,
      verificationTokensTable: authVerificationTokens,
    }),
    session: { strategy: "database" },
    logger: {
      // A refused email and a used or expired link are normal events, not errors: one line, no stack.
      error(error) {
        if (error instanceof AuthError && EXPECTED_ERRORS.has(error.type)) {
          console.warn(`[auth] ${error.type}`);
          return;
        }
        console.error(error);
      },
    },
    pages: { signIn: LOGIN_PATH, verifyRequest: LOGIN_PATH, error: LOGIN_PATH },
    providers: [
      Resend({
        // The key is read by our mailer, not by the provider. The provider needs a value.
        apiKey: process.env.RESEND_API_KEY || "console",
        from: process.env.EMAIL_FROM,
        normalizeIdentifier(raw) {
          const email = normalizeEmail(raw);
          if (!isValidEmail(email)) throw new Error("Not a valid email address.");
          return email;
        },
        async sendVerificationRequest({ identifier, url }) {
          const editor = await findEditorByEmail(db, identifier);
          // The signIn callback already refused unknown emails; this is a second guard.
          if (!editor || !canSignIn(editor)) {
            throw new Error("Refused to send a magic link to a non-Editor.");
          }
          await mailer.sendMagicLink({
            to: identifier,
            url,
            kind: magicLinkKind(editor),
            loginUrl: new URL(LOGIN_PATH, url).toString(),
          });
        },
      }),
    ],
    callbacks: {
      /**
       * Runs before Auth.js makes a token and sends the email, and again when the link is used.
       * Only an invited, active Editor gets through. A refusal sends no email.
       *
       * At the link request, a refusal returns the same redirect as a sent link (no token, no
       * email), so the response does not show who is an Editor. At the link click, the person has
       * proved the address, so a refusal is a plain `false` (AccessDenied).
       */
      async signIn({ user, email }) {
        const editor = user.email ? await findEditorByEmail(db, user.email) : null;
        if (canSignIn(editor)) return true;
        console.warn("[auth] Refused sign-in: not an active Editor.");
        return email?.verificationRequest ? VERIFY_REQUEST_PATH : false;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
}
