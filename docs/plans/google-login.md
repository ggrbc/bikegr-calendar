# Plan — Google login for Editors

Stream: `google-login`. Terms follow [CONTEXT.md](../../CONTEXT.md) (Editor, Admin). Branch
`google-login`, from `origin/main` (f24c1e2). **Approved by Jeremy ("go", Q52 = A), 2026-10-10:**
the recommended option of each open decision below (B, B, A, A).

## Context

- Today the login is magic link only (the Auth.js Resend provider) and invite only. The design moved
  "Google login" to "after cutover" ([design.md](../design.md), Scope and Stack). The cutover is
  done; bikegr.org is live with real Editors.
- Most Editors have a Google account (the Bike GR Google Workspace, or Gmail). One click is faster
  than a wait for an email, and it costs no Resend quota.
- The invite-only rule must not change: only an invited, active Editor can sign in. A Google
  sign-in must never make an Editor row.
- The schema already has `auth_accounts` "for Google login after cutover"
  ([app-skeleton-and-admin-auth.md](app-skeleton-and-admin-auth.md), "Auth.js tables"). **No
  migration is necessary.**

### What Auth.js does (read in `@auth/core` 0.41.3, `@auth/drizzle-adapter` 1.11.3)

1. **The order of the OAuth callback** (`lib/actions/callback/index.js`). Auth.js does the code
   exchange (PKCE), and reads the ID token claims as the profile. Then it calls
   `getUserByAccount(google, sub)`. Then it calls our `signIn` callback with
   `user: userByAccount ?? userFromProvider`, `account`, and `profile` (the Google ID token claims,
   with `email_verified` and `hd`). **Only after `signIn` returns true** does it call
   `handleLoginOrRegister`. So a refusal in `signIn` stops every write: no user, no link, no session.
2. **`createUser` for an unknown person** (`handle-login.js`, OAuth branch). If no account link
   exists and no user has the email, Auth.js calls `createUser({ ...profile, emailVerified: null })`.
   The Drizzle adapter inserts that into `editors`. The row gets `role = 'editor'` (the column
   default) and `deactivated_at = null`. **So with no refusal, any Google user would become an
   active Editor.** The `signIn` callback refuses this case before it can happen. We also add a
   second guard: our adapter's `createUser` always throws. Auth.js never has a reason to make an
   Editor: the invite inserts the row itself.
3. **`allowDangerousEmailAccountLinking`** (same branch). With no link and a user with the same
   email, Auth.js throws `OAuthAccountNotLinked`. With the flag set, it links the Google account to
   that user. It does not set `emailVerified`. It stores the Google tokens (`access_token`,
   `id_token`, `refresh_token`) with the default `account()` callback. It also calls
   `events.createUser` for a user that it did not create.
4. **The signed-in path** (same branch, `if (user)`). If the browser already has a session (Editor
   A) and the Google account is not linked, Auth.js links the Google account **to A**, whatever the
   Google email is. Our `signIn` callback lets the Google sign-in through when the Google email is
   an active Editor (Editor B). So, on a shared computer where A did not sign out, B's Google
   sign-in would link B's Google account to A's row. After that, B's Google sign-in opens A's
   account (and A's role). The plan must block this.
5. **A known link** (`getUserByAccount` finds the Editor). Then `user` in the `signIn` callback is
   the Editor row, not the Google profile. If a different Editor is signed in, Auth.js throws
   `OAuthAccountNotLinked`.
6. **The rate limit.** The `signIn` callback runs the magic-link limits only when
   `email.verificationRequest` is true. An OAuth callback has no `email` argument, so today's code
   already skips the limits for Google, and a refusal returns `false` (AccessDenied).
7. **The Google provider** (`providers/google.js`) is OIDC with the issuer
   `https://accounts.google.com` (discovery). Default checks: `["pkce"]`. Default scope:
   `openid profile email`. next-auth reads `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` by itself. The
   provider takes `[customFetch]` (exported by `@auth/core`), so a test can answer the discovery and
   token requests with no network.
8. **Errors.** A refusal is `AccessDenied` → `/login?error=AccessDenied`. A user who cancels at
   Google gets `OAuthCallbackError`. Both are client-safe types. A thrown adapter error becomes
   `error=Configuration`. Event errors (`events.*`) are logged and do not stop the sign-in.
9. **Deactivation today** (`src/admin/editors/editors.ts`, not in this stream): it sets
   `deactivated_at`, deletes the Editor's sessions and verification tokens, and keeps the row.
   It does not touch `auth_accounts`.

## Approach

### Rules (`google-auth-rules`, new `src/auth/google.ts`, pure)

- `googleSignInEmail(profile)`: returns the normalized email (`normalizeEmail`: NFKC, trim,
  lowercase) only when `profile.email_verified === true` and the email is valid (`isValidEmail`).
  Else null.
- `isGoogleAuthoritative(profile)`: the account rule from the open decision
  `google-account-scope`. With the recommended option B: true for an `@gmail.com` address, and true
  for a Workspace account whose `hd` claim equals the email's domain. False for a Google account
  made on another provider's address (for example a Google account on `x@yahoo.com`). This is
  Google's own rule for when Google is authoritative for an email.

### Provider (`google-provider`, `src/auth/config.ts`, `src/auth/index.ts`)

- `AuthDeps` gets `google: { clientId, clientSecret, fetch? } | null`. `src/auth/index.ts` gives it
  from `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, or null when either is empty. The `fetch` is for
  tests only (`[customFetch]`).
- **No credentials, no Google:** with `google: null`, the providers list has only Resend, and the
  login page shows no Google button. So local development, the tests, and the Preview deployments
  work as today, and the merge is safe before Jeremy sets the env values.
- Google provider options: `authorization.params`: `scope: "openid email"` (we use no name and no
  picture), `prompt: "select_account"` (an Editor with two Google accounts can pick one), and `hd`
  only if the answer to `google-account-scope` is A.

### Invite only (`google-invite-only`, `signIn` callback)

The `signIn` callback gets one new branch for `account.provider === "google"`. It runs before
`handleLoginOrRegister`, so a refusal writes nothing.

1. `googleSignInEmail(profile)` must not be null, and `isGoogleAuthoritative(profile)` must be
   true. Else refuse.
2. Find the Editor. A linked account gives `user` as the Editor row: use it. Else find the Editor by
   the Google email (`findEditorByEmail`).
3. `canSignIn(editor)` must be true (the same rule as the magic link). Else refuse.
4. A refusal returns `false` → `/login?error=AccessDenied`, the same answer as a refused magic
   link at the click. The log line is the same as today, `[auth] Refused sign-in: not an active
   Editor.`, with no email. The person has proved the Google account, so the answer shows only
   whether *their own* account is an Editor. That is not enumeration.
5. **Second guard:** the adapter is `DrizzleAdapter(…)` with `createUser` replaced by a function
   that throws `Auth.js must not create an Editor.`. The invite inserts Editor rows; Auth.js only
   reads and updates them.

### Account linking (`google-account-linking`)

Recommended (open decision `google-link-method`, option B): **our own link step in the `signIn`
callback**, with no `allowDangerousEmailAccountLinking`.

- After the checks pass, the callback inserts the link:
  `insert into auth_accounts (user_id, type, provider, provider_account_id) values (editor.id,
  'oidc', 'google', sub) on conflict do nothing`. No tokens: we never call a Google API, so we keep
  no Google access token, refresh token, or ID token in the database.
- Then Auth.js's `handleLoginOrRegister` finds the link by `getUserByAccount`, and makes the
  session for that Editor. Auth.js never reaches its own `getUserByEmail` / `createUser` /
  `linkAccount` code for Google.
- **The shared-computer case** (finding 4) is safe with no extra code. The link always goes to the
  Editor who owns the Google email. If another Editor A is signed in, Auth.js sees a link to B and a
  session for A, and throws `OAuthAccountNotLinked`. A's session stays A's. The login page then
  says "You are signed in as another Editor. Sign out first, then sign in with Google."
- **A link is by Google `sub`, not by email.** If an Editor later renames their Google address, the
  link still works. The Editor row keeps its invite email; a Google sign-in never changes it.
- **`emailVerified`:** `events.signIn` sets `editors.email_verified = now()` when it is null and
  the provider is Google. So the first Google sign-in means "the invite was accepted", the same as a
  first magic-link sign-in. The Editors page shows the first sign-in, and a later magic link uses the
  "sign-in" text, not the "invite" text (`magicLinkKind`). An event error is logged and does not
  stop the sign-in.

Why not `allowDangerousEmailAccountLinking` (option A): it is safe from account takeover here,
because Google verifies the email and our `signIn` callback admits only an active Editor's email.
But it leaves three gaps that we must fill with more code: the signed-in path (finding 4) links a
Google account to whichever Editor is signed in; `emailVerified` stays null; and Google tokens are
stored unless we also override `account()`. The custom link is about 10 lines and closes all three.

### What happens when …

- **The invite email differs from the Google email** (for example invited as
  `pat@company.com`, Google account `pat.rides@gmail.com`): there is no Editor for the Google
  email, so the Google sign-in is refused with the normal message. The Editor still signs in with
  the magic link. Open decision `different-google-email`.
- **An Admin deactivates an Editor:** the existing deactivation deletes their sessions at once. The
  Google link stays in `auth_accounts`. A later Google sign-in finds the link, gets the Editor row
  as `user`, and `canSignIn` refuses it (AccessDenied, no session). If an Admin reactivates the
  Editor, Google sign-in works again with no new link. The DAL also checks `deactivated_at` on every
  request, as today. This stream does not change `src/admin/**`.
- **Rate limit:** not applied to Google, on purpose. A Google sign-in sends no email and uses no
  Resend quota. Our callback runs only after Google authenticated the person, so a script cannot
  test many emails. `POST /api/auth/signin/google` writes nothing to the database (only the PKCE
  cookie and a redirect to Google). Google limits its own sign-in. A test proves that a Google
  sign-in writes no `rate_limits` row.

### Login page (`google-login-page`, `src/app/login/**`)

- The page gets the bikegr.org look of the public side, as `/submit`: `SiteHeader`, the page gray
  `bg-brand-page`, the heading in Chivo 400, body text Open Sans 300 in `text-brand-gray`.
- Order: the heading "Sign in", one line ("Editors sign in with Google or with a link by email.
  There are no passwords."), the error message (if any), **"Sign in with Google"**, a divider "or",
  then the email form.
- "Sign in with Google" is a `<form>` with a server action `signInWithGoogle` that calls
  `signIn("google", { redirectTo: "/admin" })`. It shows only when the Google provider is
  configured (the page reads a flag from `src/auth`, never the env values).
- Button looks: open decision `google-button-look`. The "Send sign-in link" button becomes a brand
  pill: `rounded-[300px]`, `bg-brand-orange-text` (white text 5.07:1, the AA rule in design.md),
  Chivo, uppercase, as the CTA pills. The email field and the "sent" message move to the brand
  colors; every text color keeps 4.5:1 or more on its background.
- New error messages: `OAuthAccountNotLinked` → "You are signed in as another Editor. Sign out
  first, then sign in with Google." `OAuthCallbackError` → "Google sign-in did not finish. Try
  again, or get a link by email." `AccessDenied` keeps "You cannot sign in with this email. Ask an
  Admin." (now true for a Google email too).
- The logger treats `OAuthAccountNotLinked` and `OAuthCallbackError` as expected: one warn line,
  no stack, no email.

## Files to change

| File | Change |
|---|---|
| `src/auth/google.ts` | New. `googleSignInEmail`, `isGoogleAuthoritative`, the `GoogleProfile` fields we read. |
| `src/auth/google.test.ts` | New. Unit tests of the rules. |
| `src/auth/config.ts` | `AuthDeps.google`; the Google provider (when configured); the `signIn` branch; the link insert; `events.signIn` sets `emailVerified`; `createUser` guard; two more expected error types. |
| `src/auth/config.test.ts` | New Google cases through the real `Auth()` handler on PGlite with a mocked Google (below). The existing cases do not change. |
| `src/auth/editors.ts` | `linkGoogleAccount(db, editorId, sub)` and `markEmailVerified(db, editorId)`. |
| `src/auth/index.ts` | Gives `google` from `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`; exports `googleSignInEnabled()` for the page. |
| `src/app/login/page.tsx` | bikegr.org look, `SiteHeader`, the new copy and error messages, the Google button above the form. |
| `src/app/login/login-form.tsx` | Brand pill, brand field and "sent" message. |
| `src/app/login/google-button.tsx` | New. The "Sign in with Google" form and button with the Google "G" mark (inline SVG). |
| `src/app/login/actions.ts`, `actions.test.ts` | New action `signInWithGoogle`; its test. |
| `docs/design.md` | Scope: Google login is in. Stack: "Auth.js — Google and magic-link email". Editors: one bullet on Google sign-in (verified email, the account rule, link by email, no new Editors). |
| `docs/plans/app-skeleton-and-admin-auth.md` | "Auth.js tables": `auth_accounts` is now used, link to this plan. |
| `.env.example` | `AUTH_GOOGLE_ID=` and `AUTH_GOOGLE_SECRET=` (empty), with a comment: leave empty to hide Google sign-in. |

Not touched: `src/app/admin/**`, `src/admin/**`, `src/db/schema.ts`, `drizzle/**` (no migration).

## Verification

Test first (Vitest), small commits. Run `pnpm test --hookTimeout=120000 --testTimeout=120000`
(no `--`).

**Mocked Google.** The test gives the provider a `[customFetch]` that answers
`https://accounts.google.com/.well-known/openid-configuration` and the token endpoint. The token
response holds an ID token signed RS256 with a key made by WebCrypto in the test; its claims
(`sub`, `email`, `email_verified`, `hd`, `aud`, `iss`, `iat`, `exp`) come from each test case. The
flow is the real one: `POST /api/auth/signin/google` (with CSRF) → 302 to Google with the PKCE
challenge → `GET /api/auth/callback/google?code=…` with the PKCE cookie. No network.

**`google-invite-only` (real `Auth()` on PGlite):**
- "a Google email that is not an Editor is refused with AccessDenied, and writes no editors row, no
  auth_accounts row, and no session"
- "`email_verified: false` is refused, also for an Editor's email"
- "a Google account that is not authoritative for its email is refused" (per the
  `google-account-scope` answer; with B: `x@yahoo.com` with no `hd`, and `hd` that differs from the
  email domain)
- "a deactivated Editor's linked Google account is refused and makes no session"
- "a refused Google sign-in logs one warn line with no email"
- "the adapter's `createUser` throws"
- "a Google sign-in writes no `rate_limits` row"

**`google-account-linking`:**
- "an active Editor's first Google sign-in links the account, makes a session, and redirects to
  /admin" — one `auth_accounts` row (`google`, the `sub`, the Editor's id), every token column null
- "the second Google sign-in uses the link and adds no row"
- "an upper-case Google email matches the Editor"
- "the first Google sign-in sets `emailVerified`; the next magic link has the kind `sign-in`"
- "an Editor's invite email that differs from the Google email is refused"
- "signed in as Editor A, a Google sign-in as Editor B gets OAuthAccountNotLinked; A's session is
  unchanged, and no Google link points to A"

**`google-provider`:** "with no Google credentials, the only provider is Resend, and
`/api/auth/signin/google` does not exist". The existing auth cases (magic link, rate limit, logs)
still pass.

**`google-login-page`:** `actions.test.ts`: "`signInWithGoogle` calls `signIn('google', {
redirectTo: '/admin' })`". Manual, local only (Docker Postgres, the local OAuth client):
screenshots of `/login` at 375 px and 1280 px, with and without the Google env; a seeded Admin signs
in with Google and lands on `/admin`; a non-Editor Google account gets the refusal message; a
cancel at Google gets the "did not finish" message. Contrast check of every text color on the page.

**Checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` with no `DATABASE_URL`,
no `AUTH_SECRET`, and no `AUTH_GOOGLE_*`.

**Production:** no migration. The merge is safe before the env is set (no button). After Jeremy
adds the two env values to the Production environment, a redeploy turns Google sign-in on.

## Items

- `google-auth-rules` — pure rules in `src/auth/google.ts`: verified, normalized Google email; the account rule (`hd` / Gmail).
- `google-provider` — the Google provider next to Resend, only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set; scope `openid email`; `prompt=select_account`.
- `google-invite-only` — the Google branch of the `signIn` callback (verified email, account rule, active Editor) and the `createUser` guard.
- `google-account-linking` — our own link step (`auth_accounts`, no tokens) and `emailVerified` on the first Google sign-in.
- `google-login-page` — the bikegr.org look of `/login`, "Sign in with Google" above the email form, the brand pill, the server action.
- `google-auth-errors` — login page messages and expected log lines for `OAuthAccountNotLinked` and `OAuthCallbackError`.
- `google-login-docs` — design.md, the auth plan note, `.env.example`.

## Open decisions

1. **`google-account-scope` — which Google accounts may sign in (the `hd` question).** The `hd`
   authorization parameter only filters the account picker at Google; a person can remove it from
   the URL. So the server must check the `hd` claim in every option.
   - A: only `bikegr.org` Workspace accounts. Send `hd=bikegr.org`; refuse unless the `hd` claim is
     `bikegr.org`. The consent screen can be **Internal**. An Editor with a Gmail address uses the
     magic link.
   - B: any account for which Google is authoritative: an `@gmail.com` address, or a Workspace
     account whose `hd` claim equals its email domain (`bikegr.org`, or a company domain). No `hd`
     parameter. The consent screen must be **External**. **(Recommended.)** It covers the Editors
     with Gmail, and it follows Google's own rule for when `email_verified` is reliable.
   - C: any Google account with `email_verified: true`. External. Simplest, but it also admits a
     Google account that someone made on a non-Google address (for example an old work address
     that the person lost). Invite only limits the risk, but B closes it at no cost.
2. **`google-link-method` — how the first Google sign-in links to the Editor row.**
   - A: `allowDangerousEmailAccountLinking: true`, plus code for the three gaps (the signed-in path,
     `emailVerified`, stored tokens).
   - B: our own link step in the `signIn` callback (insert into `auth_accounts`, no tokens), and no
     flag. **(Recommended.)** One place for every rule, and Auth.js's own `OAuthAccountNotLinked`
     blocks the shared-computer case.
3. **`different-google-email` — the invite email differs from the Google email.**
   - A: refuse the Google sign-in (the normal message). The Editor uses the magic link. If they want
     Google, an Admin deactivates the old row and invites the Google email (the audit trail keeps
     the old name). **(Recommended for this stream.)**
   - B: a "Connect Google" button for a signed-in Editor, which links any verified Google account
     to the current Editor. It needs an account page in `/admin` (the admin design stream owns it)
     and the session in the `signIn` callback. A later stream.
4. **`google-button-look` — the look of "Sign in with Google".**
   - A: Google's own light button, in a pill shape: white fill, 1 px `#747775` border, `#1F1F1F`
     text, the four-color "G" mark, the text "Sign in with Google". Google's branding guidelines
     allow the pill shape. Next to it, the email form keeps the bikegr.org orange pill. **(Recommended:
     people trust the Google button they know, and it obeys Google's rules.)**
   - B: a bikegr.org orange pill with a white "G" mark. It matches the site, but Google's
     guidelines do not allow a recolored "G" mark.

## Setup steps for Jeremy

Do these when the code is merged (the button stays hidden until the env values exist). Never paste
the client secret into a command line, a chat, or a commit.

**A. Google Cloud project** (as a `bikegr.org` Workspace user who may make projects; the
`web@bikegr.org` group cannot sign in to the console)

1. Go to <https://console.cloud.google.com>. In the project picker, select the organization
   **bikegr.org**, then **New project**. Name: `bikegr-calendar`. Location: the `bikegr.org`
   organization.
2. **IAM & Admin → IAM:** add a second Bike GR person as **Owner**, so the project does not depend
   on one account.

**B. Consent screen** (menu **Google Auth Platform**; Google moved the "OAuth consent screen" here)

3. **Get started** (or **Branding**): App name `Bike GR Calendar`. User support email: a
   `bikegr.org` address that Bike GR reads. Upload no logo (a logo needs Google's brand review).
4. **Audience:** **External** for decision `google-account-scope` B or C; **Internal** for A.
   Contact email: the same Bike GR address.
5. **Branding:** App home page `https://calendar.bikegr.org`. Privacy policy: the Bike GR privacy
   page on `www.bikegr.org`. Authorized domains: `bikegr.org`.
6. **Data Access → Add or remove scopes:** select only `openid` and
   `.../auth/userinfo.email`. These are non-sensitive scopes, so Google needs no app verification.
7. External only: **Audience → Publish app** → status **In production**. If it stays in
   **Testing**, only the listed test users can sign in.

**C. OAuth clients** (**Google Auth Platform → Clients → Create client**, type **Web application**)

8. Production client. Name: `Bike GR Calendar — production`. Authorized JavaScript origins: none
   needed. Authorized redirect URIs:
   `https://calendar.bikegr.org/api/auth/callback/google`
9. Local client (recommended: a separate client, so the production secret is never on a laptop).
   Name: `Bike GR Calendar — local`. Authorized redirect URIs:
   `http://localhost:3000/api/auth/callback/google`
10. For each client, copy the **Client ID** and the **Client secret** into Bike GR's password
    manager at once. (The console shows the full secret only when you make it.)

**D. Vercel** (project `bikegr-calendar`)

11. Add `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` with the production client values, for the
    **Production** environment only. Mark `AUTH_GOOGLE_SECRET` **Sensitive**. Either use the
    dashboard (**Settings → Environment Variables**), or run `vercel env add AUTH_GOOGLE_SECRET
    production` and paste the value at the prompt (not on the command line).
    Do not add them to **Preview**: each Preview has a new URL that is not a registered redirect
    URI, so Google would refuse it. Previews keep the magic link only.
12. Redeploy Production (env changes apply only to a new deployment). Then `/login` shows "Sign in
    with Google".

**E. Local development**

13. In `.env.local`, set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` to the **local** client values.
    Leave them empty to hide the Google button.

**F. Workspace check** (only if the Workspace limits third-party apps)

14. In <https://admin.google.com> → **Security → Access and data control → API controls → Manage
    third-party app access**: if unconfigured apps are blocked for `bikegr.org` users, add the
    production client ID as **Trusted**. An Internal app in the same organization usually needs no
    change.
