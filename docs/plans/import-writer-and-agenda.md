# Plan — Import writer and plain agenda

Stream: `import-writer-and-agenda`. Milestone: "Engine and import" in
[build-plan.md](../build-plan.md). Terms follow [CONTEXT.md](../../CONTEXT.md).

## Context

The pure import (`importTockify(bytes, { importDate })`) and the Occurrence engine are done. This
stream finishes the milestone: write the real Bike GR data to the database (safe to run again), copy
the images to Vercel Blob, and show both Calendars in a plain agenda page that reads through the
engine. Demo on the Neon **dev** branch.

`src/engine/types.ts` does not change. PR #3 (Neon Pool `error` listener, dark-mode CSS removal) is
not redone here; if it merges first, I rebase.

## Items

- `import-writes-to-database` — `src/import/write.ts` and the CLI `pnpm import:tockify [--file path]`.
- `image-copy-to-blob` — `src/import/images.ts`: copy each image to Vercel Blob, idempotent.
- `agenda-query` — `src/agenda/load-occurrences.ts`: approved Events through the engine to view rows.
- `agenda-page` — `/rides`, `/advocacy` (one dynamic route), and `/` (All).
- `docs-mail-domain-fix` — `.env.example` `EMAIL_FROM` and the design.md "Mail domain" bullet.
- `demo-on-neon-dev` — two import runs on Neon dev, screenshots of the three pages.

## Module layout

```
src/db/mappers.ts               + importedEventToRow(event)      ImportedEvent -> events insert values
                                + overrideInputToRow(o, eventId) OverrideInput -> overrides insert values
                                (inverse of the read mappers; still the one place that knows both)
src/import/
  event-state.ts                EventState: the import-owned fields of one Event, in one canonical
                                shape. stateFromImport(event, overrides), stateFromRows(row, overrides,
                                tagSlugs), sameState(a, b)
  write.ts                      writeImport(db, result, { uncopiedImages }) -> WriteReport
  images.ts                     BlobStore interface; vercelBlobStore(token); copyImages(result,
                                { store, fetch }) -> { result, report }
  report.ts                     formatImportReport(...) -> string[]; redactSecrets(text)
  cli.ts                        `pnpm import:tockify [--file path]`
  *.test.ts                     next to each module
src/agenda/
  dates.ts                      todayInDetroit(now), agendaWindow(today) (+8 weeks), day heading and
                                time-range text
  load-occurrences.ts           loadOccurrences(db, window, calendar | null) -> AgendaRow[]
  agenda-days.ts                groupAgendaDays(rows, window) -> AgendaDay[]; badge text
  *.test.ts
src/app/
  page.tsx                      All Calendars (replaces "Coming soon")
  [calendar]/page.tsx           rides | advocacy; other slugs -> 404
  _components/agenda-list.tsx   server component that reads the database (inside <Suspense>)
```

`package.json`: add `@vercel/blob`; add script `"import:tockify": "tsx src/import/cli.ts"`.

## Import writer (`import-writes-to-database`)

### Run order in the CLI

1. `loadLocalEnv()`. Read `--file <path>`, or fetch `https://tockify.com/api/feeds/ics/bikegr` as
   bytes.
2. `importDate = todayInDetroit(new Date())` — the CLI reads the clock, the pure code does not.
3. `importTockify(bytes, { importDate })`.
4. `copyImages(result, …)` — network work, **before** any transaction.
5. `writeImport(db, result, { uncopiedImages })` — the Source IDs whose image was not copied.
6. Print the report. Exit code 1 if the feed fetch failed or any Event failed.

### How "changed" is detected

Compare **state**, not rows. `EventState` holds only the fields the import owns:

calendar, title, description, location, imageUrl, cta, tag slugs (sorted), timing, rrule, exdates
(sorted), Schedule status, Schedule note, and the Overrides (sorted by original start, without
`eventId`, absent fields absent). For an Event in `uncopiedImages`, `imageUrl` is left out of the
state and out of the update (see "image_url is never downgraded" below).

- From the import: `stateFromImport(importedEvent, itsOverrides)`.
- From the database: load the Event row, its Overrides, and its Tag slugs; map the rows through the
  existing read mappers (`eventRowToRuleInput`, `overrideRowToInput`); then `stateFromRows(…)`.
- `sameState` compares a stable JSON form (sorted keys). Equal state means **no write at all**: no
  update, no `updated_at` change, no history row.

Fields the import does **not** own, and never writes on an update: Review status, `reviewed_*`,
`deleted_*`, `predecessor_id`, Submitter fields, `created_*`. So an Editor's reject or delete stays.

### Per Event: one transaction (`db.transaction`)

Events are written one after another. Each Event:

1. Upsert the Tags it uses: `insert … on conflict (calendar, slug) do nothing`, then select their
   ids. An existing Tag keeps its name (an Editor rename stays; the slug is the key).
2. Select the Event by Source ID, its Overrides, and its Tag slugs.
3. **New** — insert the Event (Review status `approved`, `created_by` null, `version` 1), its
   Overrides, its `event_tags`, and one `event_history` row (`action` `import`, `version` 1).
4. **Same state** — nothing. Counted as unchanged.
5. **Changed** —
   - delete its `event_tags` first (a Calendar change would otherwise break the composite foreign
     key on `event_tags`);
   - update the Event: import-owned columns, `updated_by` null, `updated_at` now,
     `version = version + 1`, `where id = ? and version = ?` (0 rows → throw → rollback → reported
     as failed, "run again");
   - delete and insert its Overrides; insert its `event_tags`;
   - insert one `event_history` row (`action` `import`, the new `version`, `changed_by` null).
   - If the Event's `updated_by` was not null (or an Override has `created_by` / `updated_by`), the
     write still happens, and the report gets a warning line: "Overwrote Editor changes: <title>
     (<Source ID>)".

The history snapshot is the written Event row plus its Overrides and Tag slugs (JSON). The Admin
milestone can extend the shape.

A failure in one Event rolls back that Event only. The others are written. The report lists the
failure with its Source ID and a redacted message.

**Events in the database that the feed no longer has** (Source ID not null, not in the result) are
reported as "Not in the feed", not deleted. This includes a Series that becomes flagged later: its
old `<eventId>` row is reported, and the fallback Events are new rows with `<eventId>/<startMinutes>`.

### `WriteReport`

`inserted`, `updated`, `unchanged` (Source IDs with titles), `failed` (Source ID + message),
`editorOverwrites`, `notInFeed`, counts of Overrides and Tags written.

### CLI output

- Import date and the open-ended cut-off date.
- Series report: one line per Series — title, Source ID, Occurrences, rule or flagged, `UNTIL` or
  "open-ended", EXDATEs, Overrides.
- Flags (reason, title, detail).
- Images: copied, already in Blob, failed (with the Tockify URL), or "images not copied
  (no Blob credentials)".
- Write totals: inserted / updated / unchanged / failed; warning lines; "Not in the feed" lines.
- Every error message goes through `redactSecrets`, which hides `postgres://…`, `postgresql://…`,
  `npg_…`, `@ep-…`, `vercel_blob_rw_…`, and JWT-shaped (`eyJ…`) text. The CLI never prints
  `DATABASE_URL`, the OIDC token, the Blob store ID, or the read-write token.

## Image copy (`image-copy-to-blob`)

- `BlobStore` interface: `head(pathname) → { url } | null` and `put(pathname, bytes, contentType) →
  { url }`. `vercelBlobStore()` wraps `@vercel/blob` (`head`, and `put` with `access: "public"`,
  `addRandomSuffix: false`). Tests use an in-memory fake store and a fake `fetch`.
- **Blob credentials, OIDC first** (Jeremy, 2026-10-09). `blobCredentials(env)` returns `"oidc"` when
  `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` are both set, else `"readWrite"` when
  `BLOB_READ_WRITE_TOKEN` is set, else `null` → report "images not copied (no Blob credentials)".
  `vercelBlobStore()` passes no `token` option, so the SDK resolves the same order from the
  environment. The CLI never prints the OIDC token, the store ID, or the read-write token.
- **What the SDK does** (read in `node_modules/@vercel/blob/dist/chunk-GPSPCQKX.js`,
  `resolveBlobAuth`, and `dist/index.d.ts`, version 2.8.1, the latest): `put` and `head` both go
  through `requestApi` → `resolveBlobAuth(options)`. The order is: a `token` option (read-write);
  else an `oidcToken` option or the OIDC token from `@vercel/oidc` `getVercelOidcToken()` (the
  `x-vercel-oidc-token` request header, else `VERCEL_OIDC_TOKEN`; it refreshes an expired token in
  development through the linked project, and a failed refresh counts as no token), used with a
  `storeId` option or `BLOB_STORE_ID` (a `store_` prefix is removed); else `BLOB_READ_WRITE_TOKEN`;
  else it throws "No blob credentials found". OIDC came in 2.4.0; the refreshing token read came in
  2.5.0 (package CHANGELOG). Only the client-upload helpers in `client.js` need a read-write token;
  this import does not use them.
- For each distinct image URL in the result (fetched once per run):
  1. Download. Not HTTP 2xx, a network error, or a content type that is not `image/*` → keep the
     Tockify URL, report it as failed.
  2. Path: `events/<sha256 of the bytes, hex>.<ext>`. `ext` from the content type (`jpg`, `png`,
     `gif`, `webp`, `avif`); if unknown, from the URL path; else `img`.
  3. `head(path)`: found → use its URL ("already in Blob"); not found → `put` → use the new URL.
  4. Set `imageUrl` to the Blob URL on every Event that uses that Tockify URL.
- **Idempotence:** the path depends only on the bytes, so the same image gives the same Blob URL on
  every run, and the second run uploads nothing. The Event state is then equal, so no write.
- No Blob credentials → no download, URLs unchanged, report "images not copied (no Blob
  credentials)". The import still runs.
- Trade-off: each run downloads every image again to hash it (about 20 small files). The other
  choice, a stored map from Tockify URL to Blob URL, needs a new column for little gain.
- **`image_url` is never downgraded** (Jeremy, 2026-10-09). `copyImages` marks each Event as
  `imageCopied: true | false`. When the image was not copied (no Blob credentials, failed download,
  not an image), the writer leaves `image_url` out of the compared state and out of the update: the
  value in the database stays, so a Blob URL from an earlier run is kept. Only a successful copy sets
  `image_url`. A **new** Event with no successful copy is inserted with the Tockify URL. An Event
  with no image in the feed has nothing to copy, so its `null` is compared and written as usual.
- Copy only. No resize.

## Agenda query (`agenda-query`)

`loadOccurrences(db, window, calendar | null): Promise<AgendaRow[]>`. It takes `db` as an argument,
so tests run on PGlite and the page passes `getDb()`.

Three queries:

1. `events` where `review_status = 'approved'` and `deleted_at is null` (and `calendar = ?`).
2. `overrides` where `event_id in (…)`.
3. `event_tags` join `tags` where `event_id in (…)` and `tags.retired_at is null`.

No date prefilter in SQL: the volume is about 30 Events, and the engine finds the Occurrences in the
window. Add a prefilter when the volume grows.

Map rows with `eventRowToRuleInput` and `overrideRowToInput`, run `expandOccurrences(rule, overrides,
window)` per Event, and build:

```ts
interface AgendaRow {
  eventId: string;
  calendar: CalendarSlug;
  originalStart: OriginalStart;
  timing: Timing;              // after Overrides
  originalTiming: Timing;
  title: string;               // Override title, else the Event title
  location: string | null;     // Override location, else the Event location
  tags: { name: string; slug: string }[];   // sorted by name
  cta: { label: string; url: string } | null;
  scheduleStatus: ScheduleStatus;
  scheduleNote: string | null;
}
```

Sort: actual start (`timingStart`), then title, then Event id. A rescheduled Occurrence is one row.

## Agenda page (`agenda-page`)

### Routes

- `src/app/[calendar]/page.tsx` with `generateStaticParams` → `rides`, `advocacy`. The page awaits
  `params`; a slug that is not in `CALENDARS` calls `notFound()` (404). Cache Components does not
  allow `dynamicParams`, so `notFound()` is the slug check (Next.js 16 docs, "dynamicParams is not
  supported"). Static routes (`/admin`, `/login`) still win over the dynamic segment.
- `src/app/page.tsx` → All Calendars.
- Headings: "Rides & Events", "Advocacy", "All events".

### Rendering and caching

- The page shell (heading) is static and prerendered. `<AgendaList calendar=…>` is inside
  `<Suspense fallback="Loading events…">`.
- `AgendaList` first calls `await io()` (`next/cache`, Next.js 16.3+), then reads the clock
  (`todayInDetroit`), then `loadOccurrences(getDb(), agendaWindow(today), calendar)`. `io()` stops
  the prerender before the clock and the database, so `pnpm build` needs no database.
- **No `"use cache"` in this stream.** Each request reads the database. Reasons: the import CLI runs
  outside the app and cannot call `revalidateTag`, so a cached agenda would be stale after an import
  until its life ends; the demo must show the import at once; and the query is small. The Public
  side milestone (Embeds, Feeds) decides the cache life and the tags (`updateTag` from admin writes).

### What a day shows

`groupAgendaDays(rows, window)` (pure, unit-tested) makes the day list:

- Day heading: weekday and date ("Tuesday, October 14"). Only days with entries.
- An Occurrence is listed on the day it starts. One that started before the window (a multi-day
  Event) is listed on the first day of the window.
- Each entry: time range ("6:00 pm – 9:00 pm"), or "All day" (with "through Sunday, October 19" for
  a multi-day all-day Event), title, location, Tags, CTA link, badge, Schedule note.
- Badges: none for `scheduled`; `tentative` → "Date to be confirmed"; `cancelled` → "Cancelled";
  `postponed` → "Postponed"; `rescheduled` → "Rescheduled from Tue, Oct 14, 6:00 pm" on the new date,
  and a short entry "Rescheduled to Thu, Oct 16, 6:00 pm" on the old date (design.md: shown on both
  dates). Each entry only when its date is in the window. The query still returns one row.
- In the All view, each entry also shows its Calendar name.
- Plain Tailwind: one column, readable type, light only. No design pass, no filters, no detail page.

## Docs fix (`docs-mail-domain-fix`)

- `.env.example`: `EMAIL_FROM=Bike GR Calendar <notifications@bikegr.org>`.
- `docs/design.md` "Mail domain" bullet: Resend is verified on the root `bikegr.org`, with the records
  `send.bikegr.org` (CNAME) and `resend._domainkey.bikegr.org` (DKIM). These do not touch Google
  Workspace's root SPF. Also fix the Stack table row "Email" to match.

## Test cases

### Mappers — write direction

- Timed Event maps to `start_local` and `end_local`, with null date columns
- All-day Event maps to `start_date` and `end_date`, with null time columns
- CTA maps to the label and URL pair; no CTA gives two nulls
- Override with absent fields maps to null columns
- Write mapper then read mapper gives back the same rule and Override

### Import writer (PGlite, real fixture with import date 2026-10-09)

- First run inserts every Event, its Overrides, its Tags, and one history row for each Event
- Imported Events are approved, with no `created_by` and version 1
- Second run with the same feed changes nothing: same rows, same `updated_at` and version, no new
  history rows
- Changed title in the feed updates only that Event: version 2, one new history row
- Changed Override updates only that Series and its Overrides
- A run without Blob credentials keeps the Blob URL from an earlier run
- A failed download keeps the existing Blob URL
- A new Event with no copy gets the Tockify URL
- An Override that is gone from the feed is deleted
- A changed Tag list replaces the Event's Tags
- Fallback one-time Events keep their `<eventId>/<startMinutes>` Source IDs on the second run
- Tags with the same slug in the two Calendars stay separate Tags
- An Editor's Tag rename is kept; the import links by slug
- An Event changed by an Editor is overwritten and gives a warning line
- Review status and soft delete set by an Editor stay after an update
- An Event that the feed no longer has is reported and not deleted
- An Event that fails a database check rolls back alone; the other Events are written
- An Event that moves to the other Calendar gets the Tags of the new Calendar

### Image copy (fake store and fake fetch)

- Image is copied to `events/<sha256>.<ext>` and the Event gets the Blob URL
- Image already in the store is not uploaded again
- Two Events with the same image URL download it once
- Two URLs with the same bytes give one Blob path
- Second run gives the same Blob URLs, so the writer sees no change
- Failed download keeps the Tockify URL and is reported
- Response that is not an image keeps the Tockify URL and is reported
- Extension comes from the content type, then the URL, then `img`
- No Blob credentials keeps every URL and reports "images not copied (no Blob credentials)"
- Credentials: OIDC token with store ID wins; read-write token is the fallback; neither gives none

### Report and CLI helpers

- Report lists each Series with its rule and "open-ended" or its `UNTIL`
- Report lists flags, image failures, warnings, and "Not in the feed" lines
- `redactSecrets` hides `postgres://` and `postgresql://` URLs, `npg_` passwords, `@ep-` hosts,
  `vercel_blob_rw_` tokens, and JWT-shaped strings
- `todayInDetroit` gives the Detroit date near midnight UTC (Detroit is still on the day before)
- `agendaWindow` is today to eight weeks later, half-open

### Agenda query (PGlite)

- Pending, rejected, and deleted Events are hidden
- Cancelled Override shows with its Schedule note
- Tentative one-time Event shows with its badge status
- Calendar filter shows only that Calendar; no filter shows both
- Rescheduled Occurrence appears once, with its original and new timing
- Override title and location replace the Event's
- Retired Tags are not shown
- Rows from several Events sort by actual start

### Agenda days (pure)

- Day heading has the weekday and the date
- Timed entry shows "6:00 pm – 9:00 pm"; all-day entry shows "All day"
- Multi-day all-day entry shows its last day
- Occurrence that started before the window is listed on the first day
- `scheduled` has no badge; every other Schedule status has its badge text
- Rescheduled Occurrence shows "from" on the new date and "to" on the old date
- Rescheduled Occurrence whose old date is outside the window shows only on the new date

## Task order (test-first, one small commit per step)

1. `docs-mail-domain-fix` — the two doc edits.
2. **Add dependency and script** — `pnpm add @vercel/blob`; `import:tockify` script.
3. **Write mappers** — tests, then `importedEventToRow` and `overrideInputToRow`.
4. **Event state** — tests, then `event-state.ts`.
5. `import-writes-to-database` — writer tests on PGlite, then `write.ts`.
6. `image-copy-to-blob` — tests with fakes, then `images.ts` and `vercelBlobStore`.
7. **Report and CLI** — report and date tests, then `report.ts`, `dates.ts` (`todayInDetroit`), and
   `cli.ts`. Run the CLI once on local Docker Postgres if it is up, else on PGlite through the tests.
8. `agenda-query` — tests on PGlite, then `load-occurrences.ts`.
9. **Agenda days** — tests, then `agenda-days.ts` and the text helpers in `dates.ts`.
10. `agenda-page` — the routes and `AgendaList`; read the Next.js 16 docs for each API first.
11. **Verify** — `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (with no `DATABASE_URL`).
12. `demo-on-neon-dev` — see below.

## Demo on Neon dev (`demo-on-neon-dev`)

1. Copy `/Users/jbell/git/grcodemonkey/bikegr-calendar/.env.local` into the worktree (gitignored).
   Never print, log, or commit a value from it. Check only that the keys exist.
2. Check that the dev branch has the schema (a count query). If the tables are missing, run
   `pnpm db:migrate` against Neon dev (the dev branch only).
3. `pnpm import:tockify` twice. All output goes through a filter that hides `npg_…`, `@ep-…`,
   `postgres://…`, `postgresql://…`, `vercel_blob_rw_…`, and `eyJ…`. The second run must report 0 inserted, 0 updated.
   Images: if `BLOB_STORE_ID` (with `VERCEL_OIDC_TOKEN`) or `BLOB_READ_WRITE_TOKEN` is not in
   `.env.local`, run the demo without images and say so.
4. Count rows: Events, Overrides, Tags (a small script; prints numbers only).
5. `pnpm dev`; Playwright screenshots of `/rides`, `/advocacy`, and `/` into `.playwright-mcp/`.
6. Never touch the production database.

## Verification

- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass; the build runs with no database.
- Two import runs on Neon dev: the second reports no change.
- Screenshots show both Calendars, the All view, and the badges (cancelled, tentative).
- No change to `src/engine/types.ts`. No push, no merge.
