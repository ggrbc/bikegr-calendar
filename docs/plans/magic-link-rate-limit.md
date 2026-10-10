# Plan — Magic-link rate limit

Stream: `magic-link-rate-limit`. Terms follow [CONTEXT.md](../../CONTEXT.md). Branch
`magic-link-rate-limit`, from `origin/main` (48889ed). Status: **waiting for Jeremy's "go"** and for
the answers to the open decisions below.

## Context

- The login page (`/login`) sends a magic link to any email that a person types. The `signIn`
  callback refuses a non-Editor, so a non-Editor gets no token and no email. But an active Editor's
  email gets one token and one email **for each request, with no limit**. A script can fill an
  Editor's inbox, and Resend's free quota with it.
- The auth plan deferred this: "a rate limit on link requests (with the Submissions rate-limit
  table)" ([app-skeleton-and-admin-auth.md](app-skeleton-and-admin-auth.md), "Auth flow").
- The design says "per-IP rate limit stored in Postgres" for Submissions, and "no new service"
  ([design.md](../design.md), Stack; [build-plan.md](../build-plan.md), Defaults).
- The Submissions stream works at the same time and codes against the shared contract below. So this
  stream makes the shared module and its table; Submissions only calls it.

## Approach

### Shared rate limit (`rate-limit-module`)

**The contract (fixed; this plan does not change it):**

```ts
export interface RateLimitRule { bucket: string; limit: number; windowSeconds: number }
export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }
export async function hitRateLimit(db: Db, rule: RateLimitRule, key: string, now?: Date): Promise<RateLimitResult>
export function clientIp(headers: Headers): string | null
```

All four are exported from `@/rate-limit` (`src/rate-limit/index.ts`). No Next.js imports, so
scripts and tests can use it.

**Fixed window, not sliding window.** Each (bucket, key) has one row: the start of the current
window and the hit count. Reasons:

- It is exact: a window allows exactly `limit` hits. A sliding-window counter (two windows with a
  weight) is an estimate, so it cannot give "exactly `limit`".
- It is one row and one atomic upsert. A sliding log needs one row per hit and a count before the
  insert, which is a read-then-write race unless we lock.
- Trade-off: at a window boundary, one client can get up to `2 × limit` hits in a short time. For
  magic links and Submissions at Bike GR's volume, that is acceptable. (GCRA, a token-bucket form,
  has no boundary burst and is also one row, but its "refuse and do not count" step needs a
  conditional upsert and a second read for `retryAfterSeconds`. It is more code for a small gain.)

**Windows are aligned to the epoch:** `windowStart = floor(now / window) × window`. All keys of a
bucket share the same boundaries, so the window is easy to compute and to test.

**One atomic upsert, no race:**

```sql
INSERT INTO rate_limits AS r (bucket, key_hash, window_start, hits, expires_at)
VALUES ($bucket, $keyHash, $windowStart, 1, $windowEnd)
ON CONFLICT (bucket, key_hash) DO UPDATE SET
  hits = CASE WHEN r.window_start < EXCLUDED.window_start THEN 1
              ELSE LEAST(r.hits + 1, $limit + 1) END,
  window_start = GREATEST(r.window_start, EXCLUDED.window_start),
  expires_at = GREATEST(r.expires_at, EXCLUDED.expires_at)
RETURNING hits, window_start;
```

- `allowed = hits <= limit`. A refused hit still counts (capped at `limit + 1`), so a client that
  keeps trying does not get a new allowance.
- Postgres locks the row for `ON CONFLICT DO UPDATE`. Concurrent hits on the same key wait in line,
  and each one gets a different `hits` value. Two first hits on a new key also work: one inserts,
  the other updates. So exactly `limit` hits are allowed.
- `GREATEST` keeps a late request with a slightly older clock (another Vercel instance) in the
  current window. It does not reset the count.
- `retryAfterSeconds`: `0` when allowed; else the seconds to the window end, rounded up, at least
  `1`.

**Old rows are removed on write, without a cron.** When the upsert returns `hits = 1` (a new window
started for this key), the same call also deletes up to 500 expired rows:
`DELETE FROM rate_limits WHERE ctid IN (SELECT ctid FROM rate_limits WHERE expires_at < $now LIMIT 500)`,
with an index on `expires_at`. This runs at most once for each key in each window, is deterministic
(easy to test), and needs no Vercel cron. A key that is used again reuses its row (the upsert resets
it), so only keys that stop leave rows, and the next new window removes them. If the delete fails,
the hit result stays correct; the call logs one line (`[rate-limit] Prune failed: <code>`) and
continues.

**The stored key is an HMAC, never a raw IP or email.**

- `key_hash = base64url(HMAC-SHA256(subKey, bucket + "\n" + key))`, 43 characters.
- `subKey = HMAC-SHA256(AUTH_SECRET, "bikegr-calendar rate-limit v1")`. One derived key keeps these
  hashes separate from every other use of `AUTH_SECRET`.
- Why a server secret and not a fixed pepper: the repo is public, so a pepper in the code is known
  to everyone. All IPv4 addresses (2^32) and the short Editor list are easy to hash again, so a
  plain or peppered SHA-256 is reversible. With the secret, a copy of the table shows nothing.
- Why `AUTH_SECRET`: it is already set in every environment (Auth.js refuses to run without it), so
  no new env var. Rotating it resets all counters; that is harmless.
- With no `AUTH_SECRET`: on Vercel (`VERCEL` set) the call throws. Elsewhere (Vitest, a first local
  run) it uses a fixed dev-only key. The same pattern as the console mailer.
- The bucket is stored as plain text (it holds no personal data), so cleanup and debugging can see
  which limit a row is for.

**`clientIp(headers)`:** the first entry of `x-forwarded-for`, else `x-real-ip`, trimmed. It returns
`null` if the value is not a valid IP (`node:net` `isIP`). On Vercel, both headers hold the client's
address: Vercel overwrites `x-forwarded-for`, so a client cannot spoof it there. (Outside Vercel a
client can set the header; that is only local development.) See open decision `ipv6-prefix-key`.

### Magic-link limit (`magic-link-rate-limit`)

**Hook point: the `signIn` callback, at `email.verificationRequest`.** I read
`@auth/core@0.41.3` `lib/actions/signin/send-token.js` and `next-auth@5.0.0-beta.32`
`lib/actions.js`:

| Hook | Paths it covers | A limited request | Has the IP? |
|---|---|---|---|
| **`signIn` callback** (chosen) | All three: the `/login` server action, a direct `POST /api/auth/signin/resend`, the Admin invite action | Returns the verify-request path, the same as the existing non-Editor refusal: **no token row, no email, same redirect** | No — we inject it (below) |
| `sendVerificationRequest` | All three, but only for active Editors | Auth.js creates the token row **at the same time** (`Promise.all`), so a limited request still writes a token row. A throw changes the response for Editors only, which shows who is an Editor. | Yes (`request`) |
| Wrapper on `POST /api/auth/signin/resend` | Only direct POSTs. The server action calls `Auth()` itself, not the route, so it **misses the login page**. | A second check in each action is needed | Yes |

- The `signIn` callback is one choke point, and its "refuse with the verify-request path" answer is
  already tested to be the same as a sent link. So a limited request reuses a proven no-enumeration
  path.
- **The IP:** the callback gets no request. `buildAuthConfig` gets a new dependency,
  `getClientIp: () => Promise<string | null>` (config.ts stays free of Next.js imports).
  `src/auth/index.ts` gives it from the lazy config: `NextAuth(async (req) => …)`. For the route
  handler, `req` is the request; for a server action (`signIn()` from `/login` or the invite),
  `req` is undefined and the getter reads `headers()` from `next/headers` (server actions copy the
  browser's headers into their internal Auth.js request). The getter is lazy, so `auth()` on admin
  pages never reads it.
- **Order in the callback, only when `email.verificationRequest` is true:**
  1. Per-IP hit (`magic-link:ip`) for **every** request, Editor or not. If limited: log, return the
     verify-request path. If `getClientIp` gives `null` (local only; Vercel always sends the
     header), skip this step. A shared "unknown" key would let one client lock out everyone.
  2. The existing Editor check (unchanged). A non-Editor is refused as now.
  3. Per-email hit (`magic-link:email`), key = the normalized email, **only for an active Editor**.
     If limited: log, return the verify-request path.
  4. Return `true`: Auth.js makes the token and sends the email.
- At the link click (`email.verificationRequest` is not set), no limit runs.
- `/login` and its server action do not change: the action already returns "sent" for this redirect.
- **The log line**, one per limited request, with no email and no IP:
  `[auth] Magic link not sent: rate limit (email).` or `… (ip).`
- If the rate-limit query fails (database down), the callback throws, as `findEditorByEmail` does
  today. No email is sent (fail closed).

**Is a limit for non-Editor emails also needed? No per-email limit; yes per-IP.** I checked
`send-token.js`: for a non-Editor, the callback returns before Auth.js creates a token, and
`getUserByEmail` only reads. So today a non-Editor request writes **no** rows and sends no email. A
per-email limit for them protects nothing, and it would write one `rate_limits` row for each
random email that a script sends. The per-IP limit counts every request, so it stops a script that
sprays many emails from one client, with one row for each IP.

## Files to change

| File | Change |
|---|---|
| `src/rate-limit/index.ts` | New. Exports the contract. |
| `src/rate-limit/rate-limit.ts` | New. `hitRateLimit` (upsert, result, prune). |
| `src/rate-limit/key-hash.ts` | New. The HMAC key and `hashRateLimitKey`. |
| `src/rate-limit/client-ip.ts` | New. `clientIp`. |
| `src/rate-limit/rate-limit.test.ts`, `key-hash.test.ts`, `client-ip.test.ts` | New. Tests (PGlite). |
| `src/db/schema.ts` | New table `rate_limits` (`rateLimits`): `bucket` text, `key_hash` text, `window_start` timestamptz, `hits` integer (CHECK ≥ 1), `expires_at` timestamptz; PK (`bucket`, `key_hash`); index on `expires_at`. |
| `drizzle/0002_rate-limits.sql`, `drizzle/meta/0002_snapshot.json`, `drizzle/meta/_journal.json` | Made with `pnpm drizzle-kit generate --name rate-limits` (no database connection). |
| `src/auth/magic-link-limits.ts` | New. The two rules and `limitMagicLinkRequest(db, step, value)`. |
| `src/auth/config.ts` | `getClientIp` dependency; the limit steps in the `signIn` callback. |
| `src/auth/index.ts` | Gives `getClientIp` (request headers, else `next/headers`). |
| `src/auth/config.test.ts` | New cases through the real `Auth()` handler (below). |
| `docs/design.md` | Editors: one bullet on the magic-link limit. Stack: the rate limit is shared. |
| `docs/plans/app-skeleton-and-admin-auth.md` | "Deferred: a rate limit on link requests" points to this plan. |
| `.env.example` | Comment: `AUTH_SECRET` also keys the rate-limit hashes. No new variable. |

Not touched: `src/app/submit/**`, `src/submissions/**`, `src/app/admin/review/**`, `src/app/login/**`.

## Verification

Test first (Vitest), small commits. Run with `--hookTimeout=120000 --testTimeout=120000`.

- **`rate-limit-hit` (PGlite):** "the first `limit` hits are allowed and the next is refused";
  "a refused hit gives the seconds to the window end"; "a new window allows again"; "a late hit with
  an older clock counts in the current window"; "buckets are separate for the same key";
  "**concurrent:** 25 hits at once with `Promise.all` and limit 10 give exactly 10 allowed, and the
  row has hits 11"; "**concurrent first hits** on a new key make one row"; "expired rows are deleted
  when a new window starts, and live rows stay"; "the prune deletes at most 500 rows in one call".
- **`rate-limit-key-hash`:** "the stored key is not the raw IP or email, and no text column of
  `rate_limits` contains it"; "the same input gives the same hash; another bucket gives another";
  "on Vercel with no `AUTH_SECRET`, the call throws".
- **`client-ip`:** "first `x-forwarded-for` entry"; "`x-real-ip` when there is no
  `x-forwarded-for`"; "spaces trimmed"; "a value that is not an IP gives null"; "no header gives null";
  IPv6 cases per the `ipv6-prefix-key` answer.
- **`magic-link-rate-limit` (real `Auth()` on PGlite, in `config.test.ts`):** "the 6th request for
  one Editor in an hour sends no email and writes no token"; "a limited request has the same status
  and Location as a sent one"; "the 21st request from one IP is refused, also for a non-Editor";
  "a non-Editor email writes no `magic-link:email` row"; "a limited request logs exactly one line,
  and no log line has the email or the IP"; "a link click is not counted"; "a request with no IP
  header uses only the email limit". The existing five cases still pass.
- **Concurrency on a real server (optional):** PGlite runs one query at a time, so it proves the
  logic, not the row lock. One extra test runs the 25-hit case on Docker Postgres with 10
  connections. It runs only when `TEST_DATABASE_URL` is set and its host is `localhost` or
  `127.0.0.1`; else it is skipped. It never reads `DATABASE_URL`, so it cannot reach Neon.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` with no `DATABASE_URL` and no
  `AUTH_SECRET`.
- **Manual, local only (Docker Postgres, console mailer):** request a link 6 times for a seeded Admin
  on `/login`: 5 links print, the 6th prints none, the page shows the same "sent" message each time,
  and the server log shows one rate-limit line with no email and no IP.
- **Deploy order (Jeremy):** run `pnpm db:migrate` on production **before** this deploys. Without
  the table, the callback throws, and no Editor can get a link.

## Items

- `rate-limit-table` — `rate_limits` table in `src/db/schema.ts` and migration `drizzle/0002_rate-limits.sql` (drizzle-kit generate).
- `rate-limit-key-hash` — HMAC-SHA256 key hash with a sub-key derived from `AUTH_SECRET`; dev-only fallback; throws on Vercel with no secret.
- `rate-limit-hit` — `hitRateLimit`: fixed window, one atomic upsert, `retryAfterSeconds`, prune of expired rows on a new window.
- `client-ip` — `clientIp(headers)` from `x-forwarded-for` / `x-real-ip`, validated.
- `magic-link-rate-limit` — per-IP (all requests) and per-email (active Editors) limits in the `signIn` callback at `email.verificationRequest`; `getClientIp` from `src/auth/index.ts`; one log line.
- `rate-limit-docs` — design.md, the auth plan's "Deferred" note, `.env.example` comment.

## Open decisions

1. **`magic-link-limits` — the numbers.**
   - A: per email 5 per hour, per IP 20 per hour. **(Recommended.)** A person who lost an email
     can try again several times; a script gets at most 5 emails into one inbox each hour (up to 10
     at a window boundary).
   - B: per email 3 per 15 minutes, per IP 10 per 15 minutes. Faster recovery, but up to 12 emails
     per hour into one inbox.
   - C: other numbers from Jeremy.
2. **`invite-and-ip-limit` — Admin invites count against the Admin's IP.** The invite action calls
   `signIn()`, so each invite is one hit on `magic-link:ip`. If an Admin invites more than the IP
   limit in one hour, the next invite shows "sent" but sends no email (the log shows the line, and
   the new Editor can still get a link at `/login`).
   - A: no exemption; the IP limit (20 per hour) is high enough for a normal invite session.
     **(Recommended: simple, no new mechanism.)**
   - B: exempt invites with an `AsyncLocalStorage` flag that only the invite action sets around its
     `signIn()` call (about 15 lines). A client cannot set it, because it is in-process.
   - C: the invite action shows a clear error when the limit refused the email (the Admin is
     trusted, so this shows nothing to the public). Needs B's mechanism or a return value from the
     callback, so it is B plus a message.
3. **`ipv6-prefix-key` — group IPv6 addresses by /64.** One home or phone connection usually gets a
   whole /64 (2^64 addresses), so a per-address limit on IPv6 is easy to get around.
   - A: `clientIp` returns an IPv6 address as its /64 prefix (`2001:db8:1:2::/64`); IPv4 stays as
     it is. JSDoc says so. Submissions gets the same benefit with no change. **(Recommended.)**
   - B: `clientIp` returns the full address; the caller groups if it wants.
4. **`rate-limit-secret` — which secret keys the HMAC.**
   - A: a sub-key derived from `AUTH_SECRET`. No new env var. **(Recommended.)**
   - B: a new `RATE_LIMIT_SECRET` (Jeremy adds it to Vercel for Production and Preview). Separate
     rotation, one more secret to manage.
5. **`migration-number-coordination` — the Submissions stream and `0002`.** This stream takes
   `drizzle/0002_*`. If Submissions also needs a migration, two `0002` files and two journal entries
   will conflict.
   - A: this stream merges first; Submissions makes its migration after a rebase (it becomes
     `0003`). **(Recommended.)**
   - B: Submissions adds its columns to this migration (couples the two streams).
6. **`docker-concurrency-test` — the optional real-Postgres concurrency test.**
   - A: add it, gated on `TEST_DATABASE_URL` with a localhost-only check, skipped by default.
     **(Recommended.)** I run it once on Docker Postgres if Docker is up.
   - B: PGlite only.

Contract: no change needed.
