# Plan — app skeleton and admin auth

Stream: `app-skeleton-and-admin-auth`. Milestone "Admin", auth and skeleton part only. Terms follow
[CONTEXT.md](../../CONTEXT.md).

## Context

Every later Admin feature (Event edit, Review queue, Tags) needs a database schema, a login, and a
protected admin shell. This stream supplies them. The Occurrence engine and the Tockify import are
built in parallel by another stream. This stream does not change `src/engine/**` or `src/import/**`.

## Library and driver choices

| Concern | Choice | Trade-off |
|---|---|---|
| ORM | `drizzle-orm` 0.45 (latest stable) + `drizzle-kit` 0.31 | 1.0 is still RC. 0.45 is what `@auth/drizzle-adapter` 1.11 is built against. Upgrade to 1.0 when it is stable. |
| Auth | `next-auth` 5 beta (Auth.js v5) + `@auth/drizzle-adapter` | The design says Auth.js. v5 is still "beta" after 2 years and gets mostly maintenance now (the Better Auth team owns it). It declares `next ^16` as a peer. Better Auth is the active alternative, but it is a design change; not proposed now. |
| Production driver | `drizzle-orm/neon-http` (`@neondatabase/serverless`) | As the design says. One HTTP request per query, no pool, good for serverless. **Limit:** no interactive transactions — only `db.batch([...])`. See "Decision for Jeremy". |
| Local driver | `drizzle-orm/postgres-js` (`postgres`) against Docker Postgres 17 | Plain TCP, no native build step. The `db` module picks the driver: a `DATABASE_URL` host that ends in `.neon.tech` uses `neon-http`; all other hosts use `postgres-js`. Both are typed as one `Db` type (`PgDatabase<…, typeof schema>`), so callers never see the driver. |
| Test database | `@electric-sql/pglite` (real Postgres compiled to WASM, in process) via `drizzle-orm/pglite` | Tests run the real migration SQL, CHECK constraints, and FKs with no Docker and no network, so `pnpm test` works in CI. Cost: a third driver, test-only. Docker Postgres is still used for the end-to-end login check. |
| Email | `resend` SDK when `RESEND_API_KEY` is set; else a console transport that prints the magic link | The Submissions milestone reuses the same mailer module. |
| Seed and scripts | `tsx` (dev dependency) runs `src/db/seed.ts` | Node 24 type stripping cannot resolve the `@/` alias. |

### Decision for Jeremy — transactions on Neon HTTP

This stream needs no transactions (each write is one statement). The Admin milestone does: the
`version` check plus the `event_history` snapshot, and the Series split, must be atomic.

- **Option A (my default):** keep `neon-http` and write those paths as `db.batch([...])`
  (non-interactive, one round trip, atomic). Read-then-decide logic happens before the batch; the
  `version` predicate in the `update … where` keeps it safe.
- **Option B:** use `drizzle-orm/neon-serverless` (WebSocket `Pool`) in production. Full interactive
  transactions, but a socket per invocation and more cold-start cost.

I build the `db` module so that either option is a one-file change. No answer is needed before "go".

## Time storage — why these column types

- **Timed Events: `timestamp without time zone`** (`start_local`, `end_local`) plus `time_zone text`.
  A `timestamp` with no zone *is* a wall-clock value: "2026-05-05 18:00" stays 18:00 across DST. A
  `timestamptz` stores an instant (UTC); a weekly 6 pm ride would come back as 5 pm or 7 pm after a
  DST change unless every read converts it back. The `RRULE` repeats a wall-clock slot, so the stored
  value must be wall-clock. `timestamp` (not `text`) gives date validation, ordering, and range
  queries for free.
- **A custom Drizzle column type `localDateTime`** maps the column to and from the engine's
  `LocalDateTime` string (`YYYY-MM-DDTHH:mm`). The two drivers return different text forms for
  `timestamp`; the column type normalizes both, so rows map to `Timing` with no formatting code in
  callers. A CHECK keeps seconds at zero.
- **`time_zone text not null default 'America/Detroit'`**, with a CHECK that it equals
  `America/Detroit`. The design says to store the zone with the time. The CHECK stops a write of a
  zone that the engine (fixed `TIME_ZONE`) would ignore.
- **All-day Events: `date`** (`start_date`, `end_date`, end inclusive, same as the engine's `Timing`).
  An `all_day boolean` plus a CHECK makes sure exactly one shape is filled: timed columns or date
  columns, never both, never neither.
- **`exdates text[]`** and **`overrides.original_start text`** hold the engine's `OriginalStart`
  string exactly (`YYYY-MM-DDTHH:mm` for timed Events, `YYYY-MM-DD` for all-day Events). The value is a
  key, not a time to compute with; exact text equality is what the engine and the Override key need,
  and a `timestamp` cannot hold both shapes. A CHECK enforces the two formats.
- **Audit timestamps are `timestamptz`.** They are instants ("when did Tom approve it"), not
  wall-clock values.

## Schema

IDs are `uuid` with `gen_random_uuid()` default. Event IDs go into public URLs and Feed UIDs; a uuid
does not show how many Events or pending Submissions exist. Enums are Postgres enums (`pgEnum`); the
value sets are fixed by the glossary. Trade-off: a new value needs `ALTER TYPE … ADD VALUE`, and a value
cannot be removed.

Enums: `calendar` (`rides`, `advocacy`), `review_status` (`pending`, `approved`, `rejected`),
`schedule_status` (`scheduled`, `tentative`, `cancelled`, `postponed` — `rescheduled` is derived and
never stored), `editor_role` (`admin`, `editor`).

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `calendar` | `calendar` not null | |
| `title` | text not null | |
| `description` | text not null default `''` | |
| `location` | text null | |
| `all_day` | boolean not null | selects the timing shape (CHECK) |
| `start_local`, `end_local` | `timestamp` null | timed only; CHECK `end_local >= start_local` |
| `start_date`, `end_date` | `date` null | all-day only; CHECK `end_date >= start_date` |
| `time_zone` | text not null default `America/Detroit` | CHECK equals `America/Detroit` |
| `rrule` | text null | RFC 5545 value without the `RRULE:` prefix (CHECK) |
| `exdates` | text[] not null default `{}` | `OriginalStart` strings |
| `review_status` | `review_status` not null default `pending` | |
| `schedule_status` | `schedule_status` not null default `scheduled` | one-time Events; a Series uses Overrides |
| `schedule_note` | text null | one-time Events |
| `cta_label`, `cta_url` | text null | CHECK both null or both set |
| `image_url` | text null | |
| `submitter_name`, `submitter_email` | text null | never public |
| `source_id` | text null, unique | Tockify event ID |
| `predecessor_id` | uuid null → `events.id` | Series split link |
| `created_at`, `updated_at` | timestamptz not null default now() | |
| `created_by`, `updated_by` | uuid null → `editors.id` | null for public Submissions and the import |
| `reviewed_at` | timestamptz null | |
| `reviewed_by` | uuid null → `editors.id` | |
| `deleted_at` | timestamptz null | soft delete |
| `deleted_by` | uuid null → `editors.id` | |
| `version` | integer not null default 1 | optimistic concurrency |

Extra unique key `(id, calendar)` — the target of the Tag join's composite FK (see `event_tags`).
Index: partial index on `created_at` where `review_status = 'pending' and deleted_at is null` (the
Review queue). Volume is low (about 30 Events), so no other indexes now.

### `overrides`

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid → `events.id` on delete cascade | PK part 1 |
| `original_start` | text | PK part 2; `OriginalStart` format CHECK |
| `all_day` | boolean null | null = timing not changed |
| `start_local`, `end_local`, `start_date`, `end_date` | as in `events`, all null | CHECK: either no timing, or one complete shape that matches `all_day` |
| `title`, `location` | text null | null = no change |
| `schedule_status` | `schedule_status` null | null = no change |
| `schedule_note` | text null | null = no note. (A Series has no base note, so "absent" and "null" mean the same.) |
| `created_at`, `updated_at`, `created_by`, `updated_by` | as in `events` | |

A Series split moves Overrides by an `update overrides set event_id = …`.

### `tags`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `calendar` | `calendar` not null | |
| `name` | text not null | |
| `slug` | text not null | CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`; unique `(calendar, slug)` |
| `retired_at` | timestamptz null | null = active |
| `created_at`, `created_by` | | |

Extra unique key `(id, calendar)`.

### `event_tags`

`event_id`, `tag_id`, `calendar`. PK `(event_id, tag_id)`. Composite FKs:
`(event_id, calendar) → events(id, calendar)` on update cascade, on delete cascade, and
`(tag_id, calendar) → tags(id, calendar)`. Result: the database refuses a Tag from the other Calendar,
and it refuses to move an Event to the other Calendar until its Tags are cleared (the design rule).

### `editors` (also the Auth.js user table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | text not null unique | CHECK `email = lower(email)` |
| `name` | text null | |
| `role` | `editor_role` not null default `editor` | |
| `invited_by` | uuid null → `editors.id` | null for the seeded Admins |
| `invited_at` | timestamptz null | |
| `deactivated_at` | timestamptz null | null = active. Never hard-deleted. |
| `deactivated_by` | uuid null → `editors.id` | |
| `email_verified` | timestamptz null | Auth.js; set on the first login (also "invite accepted") |
| `image` | text null | Auth.js requires it |
| `created_at` | timestamptz not null default now() | |

One table, not `users` + `editors`: the glossary says an Editor *is* the invited person who logs in.
The Drizzle adapter accepts a custom user table with extra columns.

### `event_history`

`id` bigint identity PK, `event_id` uuid → `events.id`, `version` integer, `action` text (values set
in the Admin milestone), `snapshot` jsonb, `changed_by` uuid null → `editors.id`, `changed_at`
timestamptz. Index `(event_id, changed_at)`. The snapshot content is decided in the Admin milestone.

### Auth.js tables

`auth_accounts` (needed for Google login after cutover; the adapter expects it), `auth_sessions`
(`session_token` PK, `user_id` → `editors.id` on delete cascade, `expires`),
`auth_verification_tokens` (`identifier`, `token`, `expires`, PK both). The `auth_` prefix keeps
them apart from domain tables.

## Engine mapping

`src/db/mappers.ts` maps rows to the engine contract, with no change to `src/engine/types.ts`:

- `eventRowToRuleInput(row) → EventRuleInput` — `timing` from the shape columns, `rrule`, `exdates`,
  `scheduleStatus`, `scheduleNote`.
- `overrideRowToInput(row) → OverrideInput` — absent fields stay absent (not `undefined` keys).

A type test also checks that the `calendar` enum values equal `CalendarSlug` and that the stored
`schedule_status` values equal `StoredScheduleStatus`.

## Auth flow

- **Session strategy: database sessions** (`auth_sessions`). An Admin who deactivates an Editor
  removes access at once; a JWT would stay valid until it expires. Cost: one indexed query per admin
  request — not a concern at this volume.
- **Login page `/login`:** one email field. A server action calls `signIn("resend", { email,
  redirectTo: "/admin" })`. The provider is the Auth.js Resend provider with a custom
  `sendVerificationRequest` that calls our mailer (Resend or console).
- **Invite-only rule** in the `signIn` callback. It calls a pure function
  `canSignIn(editor | null)`: it allows only an Editor row that exists and has `deactivated_at` null.
  Auth.js calls the callback **before** it makes the token and sends the email, so a refused email
  gets no token and no email. It also runs again when the link is clicked, so a link sent before a
  deactivation does not work after it. Emails are made lowercase before the lookup.
- **No email enumeration:** the login page shows the same message for sent and refused:
  "If this email belongs to an Editor, we sent a sign-in link. No email? Ask an Admin." The server
  log records the refusal.
- **Every request** reads the session in the Data Access Layer (`src/auth/dal.ts`, `server-only`):
  `requireEditor()` loads the session and the Editor, checks `deactivated_at` again, and redirects to
  `/login` if any check fails. `requireAdmin()` also checks `role = 'admin'`. Every server action
  calls one of them itself; the UI hiding a form is not a check.
- **Proxy (`src/proxy.ts`), optimistic only:** for `/admin/:path*`, if no Auth.js session cookie is
  present, redirect to `/login`. No database access in the proxy.
- **Cache Components:** the admin layout renders a static shell; the part that reads the session
  sits in a `<Suspense>` boundary (the docs make a `cookies()` read outside one a build error).
- **Lazy init:** `NextAuth(() => config)` and a lazy `getDb()`, so `next build` imports no driver
  connection and needs no `DATABASE_URL`.
- **Invite (Admin only):** a server action on `/admin` calls `requireAdmin()`, validates the email and
  role, inserts the Editor (`invited_by`, `invited_at`), and then calls `signIn("resend", { email,
  redirect: false })` so Auth.js makes and sends the magic link. If the email is already an Editor,
  the action returns a clear error and sends nothing. A deactivated Editor's email also returns an
  error (reactivate is a later Admin feature).
- **Invite email text:** the mailer uses invite text ("You are invited to edit the Bike GR
  Calendar") when the Editor has never logged in (`email_verified` null), and sign-in text otherwise.
  The link expires in 24 hours (Auth.js default); the email says that the person can get a new link
  at `/login` at any time.
- **Sign-out:** a form with a server action that calls `signOut({ redirectTo: "/login" })`.

## Seed

`src/db/seed.ts` (`pnpm db:seed`) inserts the three Admins with `on conflict (email) do nothing`, so it
is safe to run again, also against production:

- `jeremy@bikegr.org` — name "Jeremy"
- `bultentom@bikegr.org` — name "Tom"
- `nate@bikegr.org` — name "Nate"

(Names are first names only; an Admin can change them later.)

## Local development

- `docker-compose.yml`: `postgres:17-alpine`, user, password, and database `bikegr`, port 5432, a named
  volume, and a health check. It matches `DATABASE_URL` in `.env.example`.
- Scripts: `db:up` (`docker compose up -d`), `db:generate` (`drizzle-kit generate`), `db:migrate`
  (`drizzle-kit migrate`), `db:seed`, `db:studio`.
- Migrations run by hand (`pnpm db:migrate` with the target `DATABASE_URL`), not in `next build`, so
  the build needs no database.

## Files

- `src/db/schema.ts`, `src/db/columns.ts` (the `localDateTime` type), `src/db/index.ts` (lazy `getDb`,
  driver choice), `src/db/mappers.ts`, `src/db/seed.ts`, `src/db/test-db.ts` (PGlite + migrations, for
  tests)
- `drizzle/0000_*.sql` + `drizzle/meta/**`, `drizzle.config.ts`, `docker-compose.yml`
- `src/auth/index.ts` (`auth`, `signIn`, `signOut`, `handlers`), `src/auth/config.ts`,
  `src/auth/rules.ts` (`canSignIn`, invite input check), `src/auth/editors.ts` (find, invite),
  `src/auth/mailer.ts`, `src/auth/dal.ts`, `src/auth/next-auth.d.ts` (session types: Editor id, role)
- `src/proxy.ts`
- `src/app/api/auth/[...nextauth]/route.ts`, `src/app/login/page.tsx` + actions,
  `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/invite-form.tsx` + actions
- `package.json` (dependencies, scripts), `.env.example` (comments only if needed)

## Test cases

Unit tests (no database):

- **Invited active Editor may sign in** — `canSignIn` returns true.
- **Unknown email is refused** — `canSignIn(null)` returns false.
- **Deactivated Editor is refused** — `canSignIn` returns false when `deactivated_at` is set.
- **Email lookup ignores case** — `Jeremy@BikeGR.org` finds `jeremy@bikegr.org`.
- **Invite input rejects a bad email** — the invite check refuses an invalid address and an unknown
  role.
- **Console transport prints the link** — with no `RESEND_API_KEY`, the mailer logs the URL and calls
  no network.
- **Resend transport sends the link** — with a key, the mailer calls the Resend client with the URL,
  the sender from `EMAIL_FROM`, and the right subject.
- **First login gets invite text** — the mailer picks invite text when `email_verified` is null.
- **Timed row maps to timed Timing** — `eventRowToRuleInput` gives `{ kind: "timed", start, end }`
  in `YYYY-MM-DDTHH:mm`.
- **All-day row maps to all-day Timing** — inclusive `endDate`.
- **Override with no changes maps to only its key** — no `undefined` keys.
- **Enum values match the engine contract** — `calendar` = `CalendarSlug`, `schedule_status` =
  `StoredScheduleStatus` (type-level and value-level).
- **Driver choice by host** — a `.neon.tech` URL picks `neon-http`; `localhost` picks `postgres-js`.

Database tests (PGlite, real migration SQL):

- **Local time stays wall-clock** — insert `2026-11-03T18:00` (after the DST change) and read back
  the same string.
- **Timing shape must be complete** — a row with both timed and date columns, or neither, is refused.
- **Zone must be America/Detroit** — another zone is refused.
- **OriginalStart format is enforced** — a bad `original_start` or `exdates` entry is refused.
- **Override key is unique** — a second Override for the same `(event_id, original_start)` is refused.
- **Tag slug is unique per Calendar** — the same slug in `rides` twice is refused; in `rides` and
  `advocacy` it is allowed.
- **Tag from the other Calendar is refused** — `event_tags` refuses an `advocacy` Tag on a `rides`
  Event.
- **Calendar move needs cleared Tags** — changing an Event's Calendar fails while it has Tags.
- **Editor email must be lowercase** — an uppercase email is refused.
- **Seed is safe to run again** — two runs give exactly three Admins.
- **Invite creates an Editor** — role, `invited_by`, `invited_at` set; the sign-in rule then allows
  that email.
- **Invite of an existing Editor fails** — clear error, no new row, no email.
- **Invite by a non-Admin is refused** — the invite logic refuses an Editor with role `editor`.

End to end, by hand (Docker Postgres, console transport), recorded in the final report:

- **Seeded Admin logs in** — `/admin` redirects to `/login`; the console link opens `/admin` with the
  Admin's name and a sign-out button.
- **Unknown email gets no link** — neutral message; nothing in the console except the refusal log.
- **Admin invites an Editor** — the console prints an invite link; the new Editor logs in and sees no
  invite form.
- **Deactivated Editor is locked out** — set `deactivated_at` by SQL; the next request redirects to
  `/login`, and a new link request is refused.
- **Sign-out ends the session** — `/admin` then redirects to `/login`.

## Task order

1. `add-db-dependencies` — `pnpm add` the libraries; scripts; `docker-compose.yml`;
   `drizzle.config.ts`.
2. `wall-clock-column-type` — test first: `localDateTime` round trip for both driver text forms.
3. `drizzle-schema` — schema, first migration (`drizzle-kit generate`, plus hand-written CHECKs and
   composite FKs if drizzle-kit cannot express them), PGlite test helper, then the database tests.
4. `engine-row-mappers` — test first: mappers and the enum match test.
5. `db-module-driver-choice` — lazy `getDb`, driver by host; test first for the choice.
6. `admin-seed` — seed script; test "Seed is safe to run again".
7. `sign-in-rules` — test first: `canSignIn`, email normalize, invite input check.
8. `magic-link-mailer` — test first: console and Resend transports, invite or sign-in text.
9. `authjs-config` — Auth.js config, route handler, `signIn` callback using the rules, database
   sessions, DAL.
10. `invite-logic` — test first: invite creates an Editor, existing Editor fails, non-Admin refused.
11. `login-page` — login form and neutral message.
12. `admin-shell` — proxy, protected layout, Editor name, sign-out, Admin-only invite form.
13. `build-without-database` — `pnpm build` with no `DATABASE_URL` and no `AUTH_SECRET`.
14. `end-to-end-login-check` — Docker Postgres, migrate, seed, the five manual checks above.

Each item is one small commit. Before the report: `pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`.

## Out of scope for this stream

Event and Tag admin screens, Series edit, Review queue, deactivate and reactivate UI, `event_history`
writes, image upload, the Occurrence engine, the Tockify import, Resend domain setup.
