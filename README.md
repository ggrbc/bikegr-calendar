# Bike GR Calendar

Community event calendars for the [Greater Grand Rapids Bicycle Coalition](https://www.bikegr.org):
**Rides & Events** and **Advocacy**. It replaced Tockify in October 2026.

| Where | What |
|---|---|
| https://calendar.bikegr.org | The site: `/rides`, `/advocacy`, and `/` (all Calendars) |
| https://www.bikegr.org/events | The Rides & Events Embed |
| https://www.bikegr.org/make-a-difference | The Advocacy Embed |
| https://calendar.bikegr.org/submit?calendar=rides | The public Submission form (`?calendar=advocacy` for Advocacy) |
| https://calendar.bikegr.org/feeds/rides.ics | ICS Feeds: `rides.ics`, `advocacy.ics`, `all.ics`; filters work as on the pages |
| https://calendar.bikegr.org/admin | The admin for Editors (invite only) |

Read first:

- [CONTEXT.md](CONTEXT.md) — the domain terms (Calendar, Event, Series, Occurrence, Submission, …).
  Use them in code, docs, and commits.
- [docs/design.md](docs/design.md) — the decisions, the data model, and the reasons.
- [docs/build-plan.md](docs/build-plan.md) — the milestones, in build order.
- [docs/plans/](docs/plans/) — one plan for each build stream, with its decisions.
- [docs/adr/](docs/adr/) — architecture decision records.

## Embed on a Squarespace page

Put this in a **Code** block (not a Markdown or Text block):

```html
<script src="https://calendar.bikegr.org/embed.js" data-calendar="rides" async></script>
```

- `data-calendar`: `rides`, `advocacy`, or `all` (default `rides`).
- `data-filters` (optional): a fixed start filter in the page URL format, for example
  `data-filters="tag=non-drop&day=tue"`.
- On the host page, filters use the prefix `bgr-` (`?bgr-day=tue`), so shared links work and do not
  clash with Squarespace's own `?q=`. See the header of [public/embed.js](public/embed.js).

## Stack

Next.js 16 (App Router, Cache Components) on Vercel · TypeScript · Tailwind 4 · Postgres on Neon with
Drizzle (PGlite in tests) · Auth.js magic links and Google sign-in, invite only · Resend email · Vercel Blob images with
sharp · Cloudflare Turnstile on the Submission form · `rrule` for Series, in America/Detroit
wall-clock time.

> This Next.js version has breaking changes. Read [AGENTS.md](AGENTS.md) and the guides in
> `node_modules/next/dist/docs/` before you change framework code.

## Folders

| Folder | What |
|---|---|
| `src/engine/` | Occurrence expansion: rules, Overrides, DST, Schedule status |
| `src/agenda/` | Public reads: filters, the cached Calendar snapshot, detail lookup |
| `src/feeds/`, `src/embed/` | ICS Feeds and the Embed protocol |
| `src/submissions/`, `src/email/` | The public form, spam control, review writes, emails |
| `src/admin/` | Admin reads and writes: Events, Series split, Overrides, Tags, Editors, images |
| `src/auth/`, `src/rate-limit/` | Auth.js config, the data access layer, the Postgres rate limit |
| `src/import/` | The Tockify ICS import (`pnpm import:tockify`) |
| `src/db/` | Drizzle schema, client, seed; migrations in `drizzle/` |
| `src/app/` | Routes; `src/proxy.ts` gives the real 404 and 410 for `/events/*` |
| `e2e/` | Playwright tests (local Docker Postgres only) |

## Local development

Needs Node 24, pnpm 10, and Docker.

1. Copy `.env.example` to `.env.local`, then run `pnpm install`, `pnpm db:up`, `pnpm db:migrate`,
   and `pnpm db:seed`. If port 5432 is in use, set `BIKEGR_PG_PORT` and change `DATABASE_URL` too.
2. Run `pnpm dev`. With no `RESEND_API_KEY`, magic links and emails print to the console.
3. The Submission form (`/submit`) needs Turnstile keys. For local work, set
   `TURNSTILE_TEST_KEYS=1` in `.env.local` and leave both Turnstile keys empty: then Cloudflare's
   always-pass test keys are used. Without keys or this opt-in, the form says "Submissions are
   closed".
4. Google login: leave `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` empty to hide the Google button.
   To try it, set them to the "local" OAuth client (redirect URI
   `http://localhost:3000/api/auth/callback/google`; see `docs/plans/google-login.md`).

## Tests

| Command | What |
|---|---|
| `pnpm test` | Vitest: unit tests, and database tests on PGlite (no Docker needed) |
| `pnpm lint`, `pnpm typecheck` | ESLint and TypeScript |
| `pnpm build` | Production build; it needs no database (`DATABASE_URL=` works) |
| `pnpm test:e2e` | Playwright: builds the app, starts it on port 3100, and serves the Embed test host on 4100 |

- On a busy machine, the PGlite start can pass the 10 s hook limit. Pass flags to vitest with **no**
  `--`: `pnpm test --hookTimeout=120000 --testTimeout=120000`. (`pnpm test -- --flag` makes vitest
  drop the flags.)
- e2e needs its own local Postgres, for example
  `BIKEGR_PG_PORT=55432 docker compose -p bikegr-e2e up -d --wait`. To use another database, set
  `E2E_DATABASE_URL`. The setup refuses any URL that is not local, so it never touches Neon.

## Deployment

- Vercel deploys `main` to production on each merge. Each PR gets a Preview deploy (behind Vercel
  login; the Submission form is closed there).
- Work goes through PRs: a plan, a build with tests first, an independent review, then the PR.
- **Migrations run on Production deploys.** `vercel.json` runs `pnpm db:migrate:deploy` after
  `next build`; it applies new files in `drizzle/` only when `VERCEL_ENV` is `production` (Preview
  and local builds skip it). A failed migration fails the deploy, and the old deploy keeps serving.
  The old code runs against the new schema until the new deploy goes live, so a migration must not
  break the code before it (add first, drop in a later PR).
- To migrate by hand (for example, to fix a failed deploy), run `pnpm db:migrate` with a temporary,
  gitignored env file that holds the production `DATABASE_URL`, and delete the file at once. Never
  put a database URL or a secret on a command line.
- Production env values live in Vercel and in Bike GR's password manager, never in the repo. The
  names are in [.env.example](.env.example): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `BLOB_STORE_ID` (Blob uses Vercel OIDC), `TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (Production only; redeploy after a change).
- After a deploy, check the public pages and that the CSS has the brand classes (one deploy once
  served stale CSS from the Vercel build cache; a redeploy without the build cache fixes it).
