/**
 * The Auth.js config: invite-only login with database sessions, by magic link and (when it is
 * configured) by Google. No Next.js imports, so the integration test can run it with the plain
 * `Auth()` handler on PGlite.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { customFetch, type AuthConfig } from "@auth/core";
import type { Account, Profile } from "@auth/core/types";
import { AuthError } from "@auth/core/errors";
import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { authAccounts, authSessions, authVerificationTokens, editors } from "@/db/schema";
import type { Db } from "@/db/types";
import { findEditorByAccount, findEditorByEmail, linkAccount, markEmailVerified } from "./editors";
import { authErrorLog } from "./error-log";
import { GOOGLE_PROVIDER_ID, googleSignInEmail, isGoogleAuthoritative, type GoogleCredentials } from "./google";
import { magicLinkKind, type Mailer } from "./mailer";
import { magicLinkLimiter } from "./magic-link-limits";
import { canSignIn, isValidEmail, normalizeEmail } from "./rules";

export const LOGIN_PATH = "/login";

/** Where Auth.js sends the browser after it sends a magic link. */
const VERIFY_REQUEST_PATH = "/api/auth/verify-request?provider=resend&type=email";

/**
 * Normal events, not errors: one warn line, no stack. `OAuthCallbackError` is Google's answer to a
 * cancel (Auth.js uses it only for an error in the authorization response); `OAuthAccountNotLinked`
 * is a Google sign-in while another Editor is signed in; `InvalidCheck` is a callback with no (or a
 * bad) PKCE cookie, for example an old tab or a cleared cookie.
 */
const EXPECTED_ERRORS = new Set<string>([
  "AccessDenied",
  "Verification",
  "OAuthCallbackError",
  "OAuthAccountNotLinked",
  "InvalidCheck",
]);

/** An OAuth error code (RFC 6749 §5.2) is ASCII; anything else is not printed. */
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

/**
 * The warn line for a token endpoint that refused the code (oauth4webapi's `ResponseBodyError`,
 * wrapped in `CallbackRouteError`): for example a replayed or expired code (`invalid_grant`). Only
 * the OAuth error code, which also shows a wrong client secret (`invalid_client`). Else null.
 */
function oauthTokenErrorLine(error: unknown): string | null {
  if (!(error instanceof AuthError) || error.type !== "CallbackRouteError") return null;
  const cause = (error.cause as { err?: unknown } | undefined)?.err;
  if (!(cause instanceof Error) || (cause as { code?: unknown }).code !== "OAUTH_RESPONSE_BODY_ERROR") return null;
  const code = (cause as { error?: unknown }).error;
  return `[auth] CallbackRouteError: OAUTH_RESPONSE_BODY_ERROR (${typeof code === "string" && OAUTH_ERROR_CODE.test(code) ? code : "unknown"})`;
}

/**
 * The Google branch of the `signIn` callback (docs/plans/google-login.md). Runs after Google
 * authenticated the person and before Auth.js writes anything, so a refusal writes nothing.
 *
 * Only an active Editor whose Google email is verified, and for which Google is authoritative, gets
 * through. The first sign-in links the Google account (`sub`) to the Editor with the same email.
 * Then Auth.js finds that link and makes the session; it never reaches its own `createUser` or
 * email-linking code. If another Editor is signed in, Auth.js refuses (`OAuthAccountNotLinked`).
 */
async function allowGoogleSignIn(db: Db, account: Account, profile: Profile | undefined): Promise<boolean> {
  const claims = profile ?? {};
  const email = googleSignInEmail(claims);
  if (!email || !isGoogleAuthoritative(claims)) {
    console.warn("[auth] Refused Google sign-in: Google does not vouch for the email.");
    return false;
  }

  const linked = await findEditorByAccount(db, GOOGLE_PROVIDER_ID, account.providerAccountId);
  const editor = linked ?? (await findEditorByEmail(db, email));
  if (!editor || !canSignIn(editor)) {
    console.warn("[auth] Refused sign-in: not an active Editor.");
    return false;
  }

  if (!linked) await linkAccount(db, editor.id, GOOGLE_PROVIDER_ID, account.providerAccountId);
  return true;
}

/** `normalizeIdentifier` throws it for a bad email. Expected: one warn line, no stack. */
class InvalidEmailError extends Error {
  constructor() {
    super("Not a valid email address.");
    this.name = "InvalidEmailError";
  }
}

export interface AuthDeps {
  db: Db;
  mailer: Mailer;
  /**
   * The client's IP for the magic-link rate limit (`clientIp` from `@/rate-limit`), or null. The
   * `signIn` callback gets no request, so the caller gives it. Called only at a link request.
   */
  getClientIp: () => Promise<string | null>;
  /** The Google client, or null: then there is no Google provider and no Google button. */
  google?: GoogleCredentials | null;
}

export function buildAuthConfig({ db, mailer, getClientIp, google = null }: AuthDeps): AuthConfig {
  const adapter = DrizzleAdapter(db, {
    usersTable: editors,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  });
  // Second guard for invite only: an Editor row comes only from an invite (or the seed). Auth.js
  // would insert an unknown person as an active Editor (the role column default); the `signIn`
  // callback refuses that first, and this refuses it again.
  adapter.createUser = async () => {
    throw new Error("Auth.js must not create an Editor. Editors come only from an invite.");
  };

  return {
    adapter,
    session: { strategy: "database" },
    logger: {
      // A refused email and a used or expired link are normal events, not errors: one line, no stack.
      error(error) {
        if (error instanceof InvalidEmailError) {
          console.warn("[auth] Refused link request: not a valid email address.");
          return;
        }
        if (error instanceof AuthError && EXPECTED_ERRORS.has(error.type)) {
          console.warn(`[auth] ${error.type}`);
          return;
        }
        const tokenError = oauthTokenErrorLine(error);
        if (tokenError) {
          console.warn(tokenError);
          return;
        }
        // Never the error itself: an AdapterError's message and cause hold the SQL and its params.
        console.error(authErrorLog(error));
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
          if (!isValidEmail(email)) throw new InvalidEmailError();
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
      ...(google
        ? [
            Google({
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              // `openid email` only: the app uses no Google name or picture. `select_account`, so an
              // Editor with two Google accounts can pick one. No `hd`: Gmail Editors are allowed, and
              // `hd` only filters Google's picker; the `signIn` callback checks the claims.
              authorization: { params: { scope: "openid email", prompt: "select_account" } },
              ...(google.fetch ? { [customFetch]: google.fetch } : {}),
            }),
          ]
        : []),
    ],
    events: {
      /** The first successful Google sign-in means "the invite was accepted", as a first magic link. */
      async signIn({ user, account }) {
        if (account?.provider === GOOGLE_PROVIDER_ID && user.id) await markEmailVerified(db, user.id);
      },
    },
    callbacks: {
      /**
       * Runs before Auth.js makes a token and sends the email, and again when the link is used.
       * Only an invited, active Editor gets through. A refusal sends no email.
       *
       * At the link request, a refusal returns the same redirect as a sent link (no token, no
       * email), so the response does not show who is an Editor. At the link click, the person has
       * proved the address, so a refusal is a plain `false` (AccessDenied).
       *
       * At the link request only, the rate limits run (docs/plans/magic-link-rate-limit.md): per IP
       * for every request, then per email for an active Editor. A limited request gets the same
       * redirect as a sent link, with no token and no email.
       *
       * A Google sign-in has its own branch (`allowGoogleSignIn`) and no rate limit: it sends no
       * email, and it runs only after Google authenticated the person.
       */
      async signIn({ user, account, profile, email }) {
        if (account?.provider === GOOGLE_PROVIDER_ID) return allowGoogleSignIn(db, account, profile);

        const limiter = email?.verificationRequest ? magicLinkLimiter(db) : null;
        if (limiter) {
          const ip = await getClientIp();
          if (ip && !(await limiter.allows("ip", ip))) return VERIFY_REQUEST_PATH;
        }

        const editor = user.email ? await findEditorByEmail(db, user.email) : null;
        if (!editor || !canSignIn(editor)) {
          console.warn("[auth] Refused sign-in: not an active Editor.");
          return limiter ? VERIFY_REQUEST_PATH : false;
        }

        if (limiter && !(await limiter.allows("email", editor.email))) return VERIFY_REQUEST_PATH;
        return true;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
}
