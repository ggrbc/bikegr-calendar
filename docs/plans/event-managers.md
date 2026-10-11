# Plan — Event managers

Stream: `event-managers`. Terms follow [CONTEXT.md](../../CONTEXT.md). Branch `event-managers`, from
`origin/main`. Ten decisions were approved by Jeremy after a design interview (Q1–Q10 below). This
plan does not reopen them. Only the items under "Open decisions" need an answer.

## Context

Group leaders of a Series (for example the Wednesday Evening Ride) post the weekly route, the
conditions (off-road or street), and weather cancellations. Today only an Editor can do this. We add a
new person type, the **Event manager**. The person can change the Occurrences of the Events that an
Editor gave them, and nothing else.

### Settled decisions

- Q1 An Event manager changes Occurrences only: Schedule status (`scheduled`, `tentative`,
  `cancelled`, `postponed`; not `rescheduled`), Schedule note, Occurrence details. For a Series the
  write is an Override with these three fields only. For a one-time Event it is the same three fields
  on the Event row. Never title, time, rule, Tags, image, CTA, location, Calendar, Series split,
  Review status, Delete.
- Q2 Same account table as an Editor: a row in `editors` with role `event_manager`. Same invite
  email, login, Deactivate, and session revocation. A grant table links a person to Events.
- Q3 Any Editor (role `editor` or `admin`) adds and removes Event managers in a "Managers" section on
  the Event edit page. Each grant and removal goes into the Event history with the Editor's name.
- Q4 A Series split copies every grant to the new Series, with a history entry. The manager keeps
  the old Series too.
- Q5 Changes are public at once (public cache invalidated). Each goes into the Event history under
  the manager's name (`updatedBy`). The dashboard "Recent changes" includes them.
- Q6 Occurrence details: plain text, paragraphs, http/https URLs become links (safe `rel`), 2,000
  characters at most. Box on the detail page of that date, above the Event description. In the Feed
  (ICS DESCRIPTION) before the Event description. Not on the agenda card. Editors can set them too.
- Q7 "My Events" page: one card per managed Event, next 8 dates, "Show more" up to one year ahead.
  Each date has "Edit" to a small form. Dates that started more than 7 days ago are read-only.
  Navigation: My Events, Account (`/admin/account`, built by another stream), Sign out.
- Q8 Grants only on approved Events. A Deleted Event keeps its grants; My Events hides it. Last
  grant removed: account stays active, My Events says "You manage no Events now". Role change to
  Editor: grants stay with no effect. A grant to an existing account sends "You can now manage
  <Event title>" with a sign-in link; a new person gets the invite. The Admin Editors page shows the
  label "Event manager".
- Q9 Term: **Event manager**. No "ride leader" or "group leader" in code.
- Q10 Access: an Event manager reaches only My Events, the date form of Events they manage, and
  `/admin/account`. Every Editor route redirects them to My Events and every Editor server action
  refuses them. Editors keep all their rights and need no grants.

## Approach

1. **Fail closed in the Data Access Layer.** `requireEditor()` today means "any active account". We
   change its meaning to "active account with role `editor` or `admin`". An `event_manager` is sent to
   `/admin/my-events` (redirect). Every existing page and server action already calls `requireEditor`
   or `requireAdmin`, so they all refuse a manager with no per-route change. A new
   `requireEventManager()` (active account, role `event_manager`) and `requireSignedIn()` (any role,
   used by My Events and Account) are added. `getCurrentEditor` stays as is. A test lists every
   server action and page module and checks that each one refuses a manager (see Verification).
2. **One write module for managers**: `src/admin/events/manager-occurrence.ts` with
   `saveOccurrenceByManager(db, actor, { eventId, originalStart }, { scheduleStatus, scheduleNote,
   occurrenceDetails })`. In one transaction it checks: the actor is an active `event_manager` with a
   grant for the Event; the Event is approved and not deleted; the date belongs to the Event; the date
   is not older than 7 days and not more than one year ahead. Then it writes only the three
   columns (Override upsert for a Series, Event row for a one-time Event), bumps `version`, writes
   history, and the action invalidates the public cache like the Editor writes do. The Editor writes
   (`saveOverride`, `editOneTimeEvent`) get the `occurrenceDetails` field too.
3. **Grants** in `src/admin/events/managers.ts`: `addManager`, `removeManager`, `listManagers`,
   `listManagedEvents`. Add and remove write history (`manager-add`, `manager-remove`, with the
   manager's email in `detail`). Add refuses a pending, rejected, or deleted Event. A new person is
   created with role `event_manager` by a new `inviteEventManager` in `src/auth/editors.ts` (the
   existing `inviteEditor` stays Admin-only).
4. **Series split** copies grants inside the split transaction (`grants-follow-split`) and writes a
   `manager-add` history entry on the new Series (detail "copied from the split"). `planSplit`'s
   moved Overrides carry `occurrenceDetails`.
5. **Public side.** `occurrenceDetails` flows through the engine `Override` and `Occurrence` types,
   the mappers, the public snapshot (`src/agenda/**`), the detail page, and `vevent.ts`. The agenda
   card does not read it. A pure helper `linkify(text)` splits text into paragraphs and parts (text or
   link). Only `http:` and `https:` are links. It is rendered with React elements, never
   `dangerouslySetInnerHTML`. Links get `rel="noopener noreferrer nofollow"`.
6. **UI.** `/admin/my-events` (cards, "Show more" via a `?more=1` search param, no client state) and
   `/admin/my-events/[eventId]/[start]` (the form: four-value status radio group, note, details
   textarea with a counter, Save). Phone first, built from `src/app/admin/_components/ui.tsx`. The
   admin layout shows the reduced navigation to a manager (My Events, Account, Sign out; no "Public
   calendar" is removed, it stays as a link in the user bar like today).
7. **Emails.** Grant to an existing account: new `src/email/manager-emails.ts`, subject "You can now
   manage <Event title>", body with a link to `/login`. New person: the normal invite text, with a
   sentence naming the Event. Sent after the transaction commits; a mail failure does not undo the
   grant (the Editor sees "Added. The email did not send." as the invite does today).

## Data model (`event-manager-schema`)

Drizzle Kit generates the migration (`pnpm db:generate`). Changes in `src/db/schema.ts`:

- `EDITOR_ROLES = ["admin", "editor", "event_manager"]`. Migration:
  `ALTER TYPE "editor_role" ADD VALUE 'event_manager'`. Postgres 12 and later accepts this inside a
  transaction. The new value only cannot be used before the commit. The migration uses it nowhere
  (no default, no insert), so one transaction is safe. We check this on PGlite and Docker Postgres. If
  the generated SQL does not run, we split it into its own migration file.
- New table `event_managers`: `event_id` uuid not null references `events(id)` on delete cascade,
  `editor_id` uuid not null references `editors(id)` on delete cascade, `granted_by` uuid references
  `editors(id)`, `granted_at` timestamptz not null default now(). Primary key `(event_id,
  editor_id)`. Index on `editor_id` (the My Events query).
- `overrides.occurrence_details` text and `events.occurrence_details` text, each with
  `check (char_length(occurrence_details) <= 2000)`. Null means "none". For an Override, `""` is not
  stored: an empty value stores null (the existing `changed()` helper uses `""` only for the
  "none on this date" case of Series values, which does not apply: a Series has no details).
- The DB check does not enforce the role of `editor_id`. The write module does (a CHECK cannot read
  another table).

## Access rules

| Who | Can do |
|---|---|
| Event manager | My Events, the date form of an Event they have a grant for (approved, not deleted, date inside the window), `/admin/account`, Sign out. |
| Event manager, other routes | Every `/admin/**` Editor page redirects to `/admin/my-events`. Every Editor server action (`requireEditor`, `requireAdmin`) redirects the same way. |
| Editor | All current rights. Managers section on the Event edit page: add and remove. |
| Admin | As Editor, plus the people rules. Can make an Event manager an Editor or Admin. |

`/admin` (dashboard) is an Editor page, so a manager lands on My Events. The proxy keeps its
cookie-only check (no role knowledge); the DAL decides. The login redirect target after sign-in is
`/admin`, which then redirects a manager to My Events.

## Files

New:
- `drizzle/0003_<generated>.sql` and `drizzle/meta/*` (generated)
- `src/admin/events/managers.ts`, `src/admin/events/manager-occurrence.ts`, `src/admin/events/occurrence-details.ts` (limit, `linkify`)
- `src/email/manager-emails.ts`
- `src/app/admin/my-events/page.tsx`, `src/app/admin/my-events/[eventId]/[start]/page.tsx`, `src/app/admin/my-events/actions.ts`, `_components/occurrence-form.tsx`
- `src/app/admin/events/_components/managers-section.tsx`, `src/app/admin/events/managers-actions.ts` (or inside `actions.ts`)
- `src/app/admin/editors/manages-list.tsx` (the `ManagesList` component, placed on the Editor detail page)
- `src/app/events/[eventId]/[start]/_components/occurrence-details.tsx`
- `e2e/event-managers.spec.ts`
- `docs/adr/0002-event-managers-share-the-editor-account-table.md`

Changed: `CONTEXT.md`, `docs/design.md`, `src/db/schema.ts`, `src/db/mappers.ts`,
`src/auth/dal.ts`, `src/auth/editors.ts`, `src/auth/rules.ts` (role labels, `canManageEvents`),
`src/engine/types.ts` and `expand-occurrences.ts`, `src/agenda/occurrence-rows.ts` and snapshot,
`src/feeds/vevent.ts`, `src/app/events/[eventId]/[start]/page.tsx`,
`src/admin/events/{overrides,edit-event,event-input,form-values,format,plan-split,split-series,queries}.ts`,
`src/app/admin/events/_components/{override-form,event-form}.tsx`, `src/app/admin/events/[id]/page.tsx`,
`src/app/admin/{layout,admin-nav,admin-nav-links}.tsx`, `src/app/admin/page.tsx`,
`src/app/admin/editors/page.tsx` and `src/app/admin/editors/[editorId]/page.tsx` (role label; Manages list), `src/admin/editors/{rules,editors}.ts` (`ROLE_LABELS` gets `event_manager`).

Base: the build starts on a branch from the new `main` after the `editors-page` PR merges. That PR adds `/admin/editors/[editorId]`, `/admin/account`, `renameEditor`, `parseEditorName`, and `ROLE_LABELS` in `src/admin/editors/rules.ts`. We link to `/admin/account` as a real page and place `ManagesList` on the detail page.

## Verification

Test first, at each item. Vitest with PGlite for the data and rule code. Playwright for the flow.

- Schema: migration applies on PGlite and on Docker Postgres (`pnpm db:migrate`); the 2,000-char
  check refuses 2,001; deleting an Event or an account removes its grants.
- Access: a table-driven test imports every `actions.ts` and page module under `src/app/admin/**`
  and the image actions, calls each exported action or page as an `event_manager`, and expects the
  redirect to My Events and no database write. The list is built from the file system, so a new
  action without a check fails the test. Editors and Admins still pass.
- Grants: add and remove write history with the Editor's name; refused on pending, rejected, deleted
  Events; a new person gets the invite; an existing account gets the grant email; Deactivate and
  session revocation work for a manager like for an Editor.
- Manager write: only the three fields change; the Override has no time or location; status
  `rescheduled` is refused; the 7-day and one-year windows; no grant or other Event's grant is
  refused; a deleted Event is refused; history has the manager's name; the cache is invalidated.
- Split: grants copy, history entry, old Series keeps its grants, moved Overrides keep their details.
- Public: details box on the detail page for that date only; ICS DESCRIPTION order; no details on the
  card; `linkify` (paragraphs, `javascript:` stays text, trailing punctuation, 2,000 characters, no
  HTML injection).
- Dashboard "Recent changes" shows manager changes. My Events: 8 dates, "Show more", read-only past
  dates, empty message, hidden Deleted Event, back after Restore.
- E2E (`event-managers-e2e`): an Editor adds a manager; the manager signs in, cancels a date with a
  note and details; the detail page and the Feed show it; the manager cannot open an Editor page; a
  split keeps the grant. Screenshots at 1280 and 375 px into `.scratch/`.
- Checks: `pnpm test --hookTimeout=120000 --testTimeout=120000`, eslint on tracked files,
  `pnpm typecheck`, `DATABASE_URL= pnpm build`, `pnpm test:e2e` on a private Docker Postgres.

## Items

- `event-manager-schema` — migration: enum value, `event_managers` table, `occurrence_details` columns with the 2,000-char check.
- `event-manager-access` — DAL fail-closed (`requireEditor` refuses managers), `requireEventManager`, `requireSignedIn`, reduced navigation, access test over every action and page.
- `event-manager-grants` — add and remove grants, invite and grant emails, Managers section on the Event edit page, history entries.
- `grants-follow-split` — a Series split copies grants and details of moved Overrides.
- `my-events-page` — the My Events page with cards, 8 dates, "Show more", empty and Deleted rules.
- `occurrence-edit-form` — the date form and `saveOccurrenceByManager` (windows, three fields, history, cache).
- `occurrence-details-public` — the details field in the engine, snapshot, detail page box, Feed, `linkify`, Editor forms.
- `recent-changes-managers` — history labels for manager changes and grants; dashboard shows them.
- `editors-page-managers` — `event_manager` in `ROLE_LABELS` (label "Event manager"); `ManagesList` component shown on the Editor detail page for a manager.
- `event-managers-e2e` — Playwright flow and screenshots.
- docs — CONTEXT.md, design.md "Event managers", the ADR, this plan.

## Defaults chosen (details; tell me if one is wrong)

- URLs: `/admin/my-events` and `/admin/my-events/<eventId>/<start>`, with `<start>` as in the public
  detail URL (`2026-10-14T1800`).
- No version check for a manager's save (last write wins on the three fields). The write still bumps
  `version`, so an Editor's open form for the same Event shows the normal conflict message on save.
- A manager sets status `scheduled` again to undo a change: see "Manager write rules". A date that an
  Editor moved (Override with a new time) keeps the new time; the manager sees the time read-only.
- The form shows the Event title and the date; it never shows other Event fields.
- Empty details or note store null. Details are trimmed; line endings become `\n`.
- The ICS DESCRIPTION is `<details>\n\n<Event description>`; the details heading line is
  `Details for <date>:` is NOT added (the Feed has no box). Only the text.
- Grant emails go through the existing transport and use the "You can now manage" subject exactly.
- The Managers section lists name or email, a status ("Invited" until the first login, "Active",
  "Deactivated"), and a Remove button with a confirm step. Pending Events show no Managers section.
- The history label of a manager's change is the Editor label plus the actor's name, for example
  "Changed one date (Oct 14)". The actor's role is not in the label.

## Decisions (answered by Jeremy)

1. **Roles.** A. "Event manager" is not in the role select or the Admin invite form. People become
   managers only through the Managers section. An Admin can promote a manager to Editor or Admin,
   never demote anyone to manager.
2. **Grant to an Editor or Admin.** A. Refused: "<Name> is an Editor and can already change every
   Event."
3. **Grant to a deactivated account.** A. Refused: "This person is deactivated. Ask an Admin to
   reactivate them first."

## Changes from the `editors-page` stream

- A name is required everywhere (`parseEditorName` refuses empty text). The Managers section asks
  for a name and an email when the person is new.
- The Admin's own Editor detail page shows no Role and no Deactivate.

## Manager write rules (corrections to the defaults)

- A manager's save updates only `schedule_status`, `schedule_note`, and `occurrence_details`. The
  upsert never overwrites the Editor columns (time, location, title) of an existing Override: the
  conflict `set` lists only those three columns plus `updated_by` and `updated_at`.
- Back to `scheduled` clears only the status. The Override row is removed only when every field in
  it is empty. A row that still has a Schedule note, Occurrence details, or Editor fields stays.
- Test: an Editor moves the time of a date, then a manager cancels that date. The new time stays.
- Last write wins (no version check) stays, because of the narrow upsert above.
