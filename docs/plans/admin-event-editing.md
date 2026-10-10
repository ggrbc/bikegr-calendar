# Plan — Admin Event editing

Stream: `admin-event-editing`. Milestone: "Admin" in [build-plan.md](../build-plan.md). Terms follow
[CONTEXT.md](../../CONTEXT.md). Branch `admin-event-editing`, made from `origin/admin-nav-shell`
(PR #5). Rebase on `main` when PR #5 merges.

## Context

The Occurrence engine, the import, and the public agenda are done. Editors can log in, but they
cannot change an Event. This stream gives Editors the Event part of the Admin milestone: create and
edit Events, the three Series edit scopes ([ADR 0001](../adr/0001-time-and-rule-changes-by-series-split.md)),
changes to one Occurrence, delete and restore, history, and a clear message when another Editor
saved first.

The parallel stream `admin-people-tags-images` builds Tag management, Editor management, and image
upload. This stream does not. `src/engine/types.ts` does not change. No schema change.

## Items

- `event-list-admin` — `/admin/events`: Events per Calendar, title search, Review status filter,
  "Show deleted" for Admins only. Each row links to the Event.
- `event-create-edit` — the create and edit form: Calendar, title, description, location, timing,
  the rule editor with a live preview of the next 10 Occurrences, Tags, CTA, image URL.
- `series-edit-scopes` — "All Occurrences" (content only), "This and following" (Series split),
  "This Occurrence" (Override). Plain-word help text for each scope.
- `occurrence-override-edit` — change one Occurrence (time, title, location, Schedule status,
  Schedule note) or clear its Override. Schedule status and note of a one-time Event.
- `soft-delete-restore` — Editors delete a whole Event; Admins restore it. No hard delete.
- `version-conflict-message` — a stale save fails with the conflict message and keeps the input.
- `event-history-view` — read-only history per Event: when (Detroit), who, what.

## Decisions to confirm

These are my choices where the docs do not say. Each one has a test.

1. **Split date on or before the first Occurrence: change in place.** The old Event would keep no
   Occurrence, so a split would leave an empty Event. Instead the same Event gets the new time or
   rule (history action `change-time-or-repeat`). No past Occurrence changes, so the ADR reason
   still holds. Typical case: a new Series with a wrong time.
2. **"Stop the Series" is part of "This and following".** The Editor picks a date and "No more
   dates from this date". The old Event gets `UNTIL` = the day before; no new Event. To extend a
   Series, the Editor splits and sets a later end on the new Event.
3. **Overrides that move in a split are re-keyed by date.** An Override keeps its fields and gets
   the original start of the new Series' Occurrence on the same date. An Override on a date that
   the new rule does not make is removed. The form lists these dates before the save; the history
   row of the new Event names them; the old Event's previous history row has their content.
4. **Skipped dates (`EXDATE`s) are editable with "All Occurrences".** A skipped date moves no time
   and leaves Overrides keyed as they are, so the ADR reasons do not apply.
5. **An Override write checks and bumps the Event's `version`.** So the change to one Occurrence is
   on its own page (one form per page): a save on one page does not make the other form stale.
6. **An Event that an Editor creates is `approved`, with `reviewed_by` and `reviewed_at` = that
   Editor and now.**

**Import guard (approved addition, `import-split-guard`, widened after the review):** the admin
wins. When the import finds an existing Event by Source ID that has an Editor history row
(`changed_by` not null: an edit, a split, a stop, an in-place change, an Override, a delete, a
restore) or a successor, it does not write that Event: no rule, timing, content, image, Override,
or Tag change, and no history row. `WriteReport.changedInAdmin` lists it, and the report prints
"Changed in the admin, not updated: <title> (<Source ID>)". `editorOverwrites` stays only for an
Editor mark with no Editor history row (a change outside the admin, for example by SQL). Tests:
"Re-import does not change an Event that an Editor edited", "Re-import does not undo Stop the
Series", "Re-import does not undo an in-place change", "Re-import still updates an Event that only
the import changed", "Re-import does not change an Event that was split in the admin".

## Module layout

```
src/admin/events/                      (no "server-only"; DB modules take `db: Db`, like the import)
  rule-form.ts          RuleForm model; ruleFormToRrule(form); rruleToRuleForm(rrule) -> RuleForm | null
  describe-rule.ts      describeRule(form | rrule) -> "Every week on Tuesday, April to October, …"
  format.ts             formatInstantDetroit(date); conflictMessage(changedAt); history action labels
  preview.ts            nextOccurrences(rule, overrides, from, count = 10) -> Occurrence[] | error
  event-input.ts        parseEventInput(raw, ctx) -> { ok, draft } | { ok: false, errors }
                        parseOverrideInput, parseSplitInput (all untrusted input -> typed drafts)
  plan-split.ts         planSplit(series, overrides, input) -> SplitPlan | error (pure)
  write-helpers.ts      claimVersion(tx, …), writeHistory(tx, …), setEventTags(tx, …), errors
  create-event.ts       createEvent(db, editor, draft)
  edit-event.ts         editSeriesContent(db, editor, …); editOneTimeEvent(db, editor, …)
  split-series.ts       splitSeries(db, editor, …)   (uses planSplit; also the in-place and stop cases)
  overrides.ts          saveOverride(db, editor, …); clearOverride(db, editor, …)
  delete-event.ts       deleteEvent(db, editor, …); restoreEvent(db, admin, …)
  queries.ts            listEvents(db, filter); loadEventForEdit(db, id);
                        loadHistory(db, eventId); loadOccurrenceForEdit(db, id, originalStart)
  seams.ts              stand-ins for the other stream's modules (see "Contract with the parallel
                        stream"): listPickerTags(db, calendar), isEventImageUrl(url)
  *.test.ts             next to each module (pure tests, and PGlite tests through createTestDb)

src/app/admin/events/
  page.tsx                           list (replaces the placeholder)
  new/page.tsx                       create
  [id]/page.tsx                      edit: scopes, Occurrence list, delete or restore, history
  [id]/occurrence/page.tsx           ?start=<original start>: change one Occurrence
  actions.ts                         thin server actions
  _components/event-form.tsx         client: controlled form model, useActionState
  _components/rule-editor.tsx        client: structured rule, end, skipped dates, Advanced (Admins)
  _components/occurrence-preview.tsx client: next 10 Occurrences from the engine
  _components/split-panel.tsx        client: "This and following": date, new time, repeat, summary
  _components/override-form.tsx      client
  _components/image-upload-field.tsx client: stand-in for the upload widget (see below)
  _components/delete-restore.tsx     client
```

`src/db/mappers.ts` may get small helpers (for example an `EventRow` -> form model mapper input);
`src/engine/index.ts` may export more of what the engine already has. Nothing else outside my
scope changes.

## Contract with the parallel stream (`admin-people-tags-images`)

Agreed interface. Those modules are not on my branch yet, and their folders are not in my scope.
So I build against the same interface with stand-ins in my own folders. The PR that merges second
rebases and changes the imports to the real modules (and deletes the stand-ins).

- **Tag picker:** `listPickerTags(db, calendar)` from `@/admin/tags/tags` → the active Tags of one
  Calendar, sorted by name, `{ id, name, slug }[]`. Stand-in: the same function in
  `src/admin/events/seams.ts` (a `tags` query: that Calendar, `retired_at is null`, by name).
- **Image upload:** `<ImageUploadField name="imageUrl" defaultValue={event.imageUrl} label="Image"
  onUploadingChange={setBusy} onChange={(url) => …} />` from `@/admin/images/image-upload-field`
  (client; renders a hidden `<input name="imageUrl">` with the URL, empty string for no image).
  Save is disabled while it uploads. Stand-in: `_components/image-upload-field.tsx` with the same
  props; it renders a plain URL text input and calls `onChange`. `onUploadingChange` is never
  called.
- **Image URL check on save:** accept the URL only if `isEventImageUrl(url)` (from
  `@/admin/images/image-url`) is true, or it is equal to the URL already stored on the Event
  (imported images); empty means no image. Stand-in `isEventImageUrl` in `seams.ts`: an `https://`
  URL. The rule "equal to the stored URL" is in my code, so it does not change at the swap.

## Every write: one transaction

Each module function runs one `db.transaction` and returns
`{ ok: true, … } | { ok: false, reason: "conflict", changedAt } | { ok: false, reason: "deleted" | "not-found" | "invalid", message }`.
Inside the transaction an error is thrown, so the transaction rolls back; the function catches it at
the end and returns the result.

**Version claim** (`claimVersion`), the first write in every transaction:

```
update events set <changes>, version = version + 1, updated_by = :editor, updated_at = now()
where id = :id and version = :formVersion and deleted_at is null
returning *
```

0 rows: read the row. No row → `not-found`. `deleted_at` set → `deleted` ("This Event was
deleted."). Else → `conflict` with the row's `updated_at`. Restore uses `deleted_at is not null`
instead.

**History** (`writeHistory`), the last write: one `event_history` row with the new `version`, the
action, `changed_by` = Editor, and `snapshot` = `{ event, overrides, tagSlugs, detail? }` — the
state after the change, in the same shape as the import's rows. `detail` carries extra facts
(`originalStart`, `splitDate`, `successorId`, `removedOverrides`).

| Write | Steps in the transaction | History action |
|---|---|---|
| `createEvent` | insert Event (`approved`, `created_by`, `reviewed_by`, version 1); insert `event_tags`; history | `create` |
| `editSeriesContent` | claim version with content columns (title, description, location, CTA, image, Calendar, `exdates`); if the Calendar changes, delete `event_tags` before the update (composite FK); replace `event_tags`; history | `edit` |
| `editOneTimeEvent` | as above, plus timing, Schedule status, Schedule note, and an optional new rule (a one-time Event can become a Series in place) | `edit` |
| `splitSeries` | see the next section | `split` (old), `create-from-split` (new) |
| `saveOverride` | claim version (no column change); upsert the Override (`created_by` on insert, `updated_by`); if every field equals the Series value, delete the row instead; history | `override` |
| `clearOverride` | claim version; delete the Override; history | `clear-override` |
| `deleteEvent` | claim version with `deleted_at = now()`, `deleted_by`; history | `delete` |
| `restoreEvent` (Admin) | claim version with `deleted_at = null`, `deleted_by = null`; history | `restore` |

**Tags in a write:** the picker shows `listPickerTags` (active Tags of the Event's Calendar). On
save, a selected Tag that the Event does not have yet must be in the Event's Calendar and not
retired: a form opened before a retire or a merge can still show it, and the save must not add a
new link to it (field error "This Tag was retired. Pick another one."). Links that the Event
already had stay, also to a retired Tag (it is not in the picker, and the form does not remove it).
The composite FK also refuses a Tag of the other Calendar, so a bad id rolls back the transaction.

## Series split (`series-edit-scopes`)

Input: old Event id and `version`, split date `D` (default: today in Detroit), the mode, and the
content fields (they apply to the new Event only).

- Mode `change`: new time slot (timed: start time and end time, an end time before the start time
  means the next day; all-day: number of days) and new repeat: **same repeat** (default),
  structured `RuleForm`, or Advanced RRULE text (Admins only).
- Mode `stop`: no more dates from `D`.

`planSplit` (pure; the form calls it for the summary, the server calls it for the write):

1. Refuse if the Event is not a Series, or is deleted.
2. `before` = Occurrences of the old rule (after `EXDATE`s) with a date before `D`.
   `following` = rule starts of the old rule with a date on or after `D` (before `EXDATE`s).
3. `following` is empty (the Series ended before `D`, by `UNTIL` or `COUNT`): refuse — "This Series
   has no dates on or after <D>. Pick an earlier date."
4. **Anchor date** of the new Series: same repeat → the date of the first item in `following` (so
   an every-2-weeks Series keeps its weeks); new repeat → `D`.
5. **New rule:** same repeat → the old rule without `UNTIL` and `COUNT`, plus the old end: an old
   `UNTIL` stays (so a chain of splits does not overlap); an old `COUNT n` becomes
   `COUNT = n − (rule starts before D)`. A new repeat → `ruleFormToRrule(form)` or the Admin's text.
   The engine checks the rule (`InvalidRuleError` → a field error).
6. **New first time slot:** the first rule start of the new rule on or after the anchor, with the new
   time of day and length. No start → refuse ("The new repeat has no dates on or after <D>").
   The new Event's `start` is always its first Occurrence.
7. **Overrides:** the old Event keeps every Override with an original start date before `D`, also
   one whose new time is on or after `D`. Each Override with a date on or after `D` (also one
   exactly on `D`, and one moved to a date before `D`) moves: it gets the original start of the new
   Series' Occurrence on the same date. No such Occurrence → it is in `removedOverrides`.
8. **`EXDATE`s:** dates before `D` stay on the old Event. Dates on or after `D` are re-keyed the same
   way onto the new Event; one with no match is dropped (it skips nothing).
9. **Old rule end:** the old rule without `UNTIL` and `COUNT`, plus `UNTIL=<D − 1 day>T235959`
   (Detroit wall-clock, the same form as the import).
10. **Kind of result:**
    - `before` is empty → `in-place` (decision 1): the same Event gets the new time slot, rule,
      re-keyed Overrides and `EXDATE`s, and the content edits. Mode `stop` here → refuse: "No dates
      would be left. Use Delete to remove the whole Event."
    - mode `stop` → `stop` (decision 2): old rule end from step 9; Overrides and `EXDATE`s on or
      after `D` are removed.
    - else → `split`.

`splitSeries` transaction for `split`:

1. Read the old row. `version` differs from the form → conflict. Make the plan from this row.
2. Claim the version on the old Event with the old rule end and the kept `EXDATE`s.
3. Delete the old Event's Overrides with a date on or after `D`.
4. Insert the new Event: same Calendar; content from the form; new time slot, rule, `EXDATE`s;
   `predecessor_id` = old id; Review status, `reviewed_*`, and Submitter fields copied;
   `created_by` = `updated_by` = Editor; Source ID null; version 1.
5. Insert the re-keyed Overrides on the new Event (`created_by` kept, `updated_by` = Editor).
6. Insert the new Event's `event_tags` (the form's Tags; same Calendar).
7. History: old Event `split` (`detail: { splitDate, successorId }`); new Event
   `create-from-split` (`detail: { splitDate, predecessorId, removedOverrides }`).

After the save the page goes to the new Event, with a link "Earlier dates: <old Event>". Each Event
page shows "Split from" and "Continued by" links (`predecessor_id`, both ways).

**Edge cases (each one is a test):**

| Case | Result |
|---|---|
| `D` before the first Occurrence | in place, same Event id |
| `D` on an Occurrence | that Occurrence is the first of the new Event; old `UNTIL` = `D − 1` |
| `D` between two Occurrences | new Event starts on the next Occurrence |
| `D` after the last Occurrence | refused |
| Series with `COUNT` | old gets `UNTIL`; same repeat → new gets the remaining `COUNT` |
| Override exactly on `D` | moves to the new Event |
| Override before `D` moved to after `D` | stays on the old Event |
| Override on a date the new rule does not make | removed, listed before the save and in history |
| Series that was already split (A → B), split B | C links to B; B's `UNTIL` changes; A does not change |
| Split A again before its end | new Event gets A's `UNTIL` by default, so it does not overlap B |

## Rule editor: form model ⇄ RRULE (`rule-form.ts`)

```ts
type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
type RuleEnd = { kind: "never" } | { kind: "until"; date: LocalDate } | { kind: "count"; count: number };
type RuleForm =
  | { repeat: "weekly"; interval: number; days: Weekday[]; months: number[]; end: RuleEnd }
  | { repeat: "monthlyWeekday"; positions: (1 | 2 | 3 | 4 | -1)[]; weekday: Weekday; end: RuleEnd }
  | { repeat: "monthlyDay"; day: number; end: RuleEnd }
  | { repeat: "yearly"; month: number; day: number; end: RuleEnd };
// "Does not repeat" is rule = null. Skipped dates are a separate LocalDate[] next to the rule.
```

| Form | RRULE (part order is the import's) |
|---|---|
| weekly, every `n` weeks, days | `FREQ=WEEKLY[;INTERVAL=n if n > 1];BYDAY=<days, Monday first>` |
| weekly, some months (1–11 picked) | `…;BYMONTH=<months, sorted>` (none or all 12 picked → no `BYMONTH`) |
| monthly, nth weekday (incl. last) | `FREQ=MONTHLY;BYDAY=2TU,4TU` / `BYDAY=-1TU` (positions sorted, `-1` last) |
| monthly, day of month | `FREQ=MONTHLY;BYMONTHDAY=15` (the import makes this shape too) |
| yearly, fixed date | `FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=14` |
| end: open-ended | no end part |
| end: until a date | `;UNTIL=<YYYYMMDD>T235959` |
| end: count | `;COUNT=n` |
| skipped dates | `exdates`: `<date>T<start time>` (timed) or `<date>` (all-day) |

`rruleToRuleForm(rrule)`: split the parts, map them to the form, then write the form back. The rule
"fits" only if the written rule has the same parts and values as the stored rule (the order of the
items in `BYDAY` and `BYMONTH` may change: the import writes days in date order). Anything else (`DAILY`, `BYSETPOS`,
`WKST`, a monthly `INTERVAL`, `UNTIL` with `Z` or as a date only, a mix of weekdays in a monthly
rule) does not fit. Then Admins see the Advanced RRULE field with the text; Editors see the rule in
words, read-only, and can still use "same repeat" in a split.

**Advanced (Admins):** a text area. The engine checks it (`InvalidRuleError` message shown under the
field). The server action refuses Advanced text from an Editor ("Only an Admin can enter RRULE
text."). The server always builds the RRULE again from the input; it never trusts a client RRULE
from a structured form.

**Validation:** weekly needs one or more days; `interval` 1–52; `count` ≥ 1; `until` on or after the
start date; a monthly day 1–31; a yearly date that exists (Feb 29 allowed). A rule with no
Occurrence → "This repeat has no dates." On create, the stored start is the first Occurrence on or
after the entered start date.

**Live preview:** `nextOccurrences` runs the engine in the browser (the engine has no server
imports): it expands one-year windows from today (Detroit, from the server) until it has 10, up to
10 years. It shows Overrides and skipped dates as the agenda does. Errors show in place of the list.

## Forms and server actions (Next.js 16)

From `node_modules/next/dist/docs` (forms, mutating data, server actions, `revalidatePath`,
authentication with Cache Components):

- Pages are static shells. Every part that reads the session, `params`, `searchParams`, or the
  database is an async component inside `<Suspense>` (as the other admin pages do). Dynamic `[id]`
  routes: read `params` inside the boundary; if the instant-navigation check fails the build, set
  `export const instant = false` as the docs say.
- Each form is a client component with the form model in `useState` (controlled inputs). This
  serves the live preview, and it keeps the input on screen after an error: React resets only
  uncontrolled fields after a form action.
- Submit: `useActionState(action, initial)`; the form's `action` dispatches the model object. The
  action is `(prev, input: unknown) => Promise<SaveState>`.
- Each action: `requireEditor()` (`requireAdmin()` for restore and for Advanced rule text), parse
  the untrusted input (`event-input.ts`), call the module with `getDb()`, then on success
  `revalidatePath` for `/admin/events`, `/admin/events/<id>` (and the new id after a split), `/`,
  `/rides`, `/advocacy`. Create and split then `redirect()` to the Event page (after the revalidate
  calls). Return values are small shapes for the UI, never rows.
- `SaveState` = `idle` | `saved` (message) | `invalid` (field errors) | `conflict` (message) |
  `gone` (deleted or not found).
- After a save, the page renders again with the new `version`. The edit form takes `key={version}`,
  so it starts again from the saved values; a "Saved" message shows from the parent.

## Conflict flow (`version-conflict-message`)

1. The edit page renders the Event with its `version`; the form keeps it in its model.
2. Editor B saves first; the Event is now version n + 1.
3. Editor A saves with version n. The version claim updates 0 rows; the row exists and is not
   deleted, so the result is `conflict` with the row's `updated_at`. The transaction rolls back:
   nothing changes, no history row.
4. The action returns `conflict` and does not revalidate. A's form keeps A's input and shows:
   "Another Editor changed this Event at 3:12 pm on Saturday, October 10 (Detroit time). Reload to
   see their change." with a Reload link.
5. The same flow applies to the split, the Override page, delete, and restore. A write to a deleted
   Event shows "This Event was deleted." instead.

## Pages

- **List** `/admin/events?calendar=rides|advocacy|all&q=&review=pending|approved|rejected&deleted=1`:
  tabs Rides & Events | Advocacy | All; a search box (title, case-insensitive, `%` and `_` escaped);
  a Review status select; "Show deleted" for Admins only (the server ignores `deleted=1` from an
  Editor). Columns: title (link), Calendar, repeat in words or the date, next date, Review status,
  a "Deleted" badge. Sorted by title. A "New Event" link.
- **Event** `/admin/events/[id]`:
  - One-time Event: the full form, plus Schedule status and Schedule note.
  - Series: a scope choice in plain words:
    - **All dates** — "Change the title, description, place, Tags, image, or button for every date.
      The time and the repeat stay the same."
    - **This date and later** — "Change the time or the repeat from a date you pick. Dates before
      it stay as they are. This makes a new Event from that date on."
    - **One date** — "Change, move, or cancel one date only. Pick it in the list below."
  - The split panel shows a summary from `planSplit` before the save ("Dates before Nov 3 stay at
    6:00 pm. From Tue, Nov 3 the ride starts at 6:30 pm. 2 single-date changes move to the new
    Event. This change to one date is removed: Tue, Nov 24.").
  - Occurrence list: 30 days back to the next 20 dates, each with its badge and a "Change this
    date" link; "Show more" (`?from=`); "Go to date" finds the Occurrence on a date.
  - Delete (Editors, with a confirm step) or, on a deleted Event, a notice and Restore (Admins).
    Editors see a deleted Event read-only.
  - History, newest first: when (Detroit), who (Editor name, else email; "Import" for no Editor),
    what (labels: Created, Edited, Series split, Created by a Series split, Series stopped,
    Changed one date (Tue, Nov 3), Removed the change to one date, Deleted, Restored, Import).
- **One Occurrence** `/admin/events/[id]/occurrence?start=…`: new time, title, location, Schedule
  status (`scheduled`, `tentative`, `cancelled`, `postponed`; "Rescheduled" shows when the time
  moves, it is never stored), Schedule note, Save and "Clear the changes to this date". A field
  equal to the Series value is stored as null; all null → no row. The original start must be one
  the Event makes and not a skipped date.

## Test cases

### Rule form (pure)

- Weekly on Tuesday writes `FREQ=WEEKLY;BYDAY=TU`
- Every 2 weeks on Thursday and Tuesday writes `INTERVAL=2` and days Monday first
- Weekly in April to October writes `BYMONTH=4,5,6,7,8,9,10`; all 12 months write no `BYMONTH`
- Monthly on the 2nd and 4th Tuesday writes `BYDAY=2TU,4TU`
- Monthly on the last Tuesday writes `BYDAY=-1TU`
- Monthly on day 15 and yearly on June 14 write their shapes
- Until a date writes `UNTIL=<date>T235959`; count writes `COUNT=n`
- Every rule in the import fixture parses to a form and writes back the same parts
- A rule with `BYSETPOS`, `DAILY`, `WKST`, or a `Z` `UNTIL` does not fit the form
- Weekly with no day, count 0, and until before the start are refused with field messages
- Rule in words: "Every 2 weeks on Tuesday and Thursday, April to October, until October 27, 2028"

### Format (pure)

- An instant formats as Detroit wall-clock time in summer and in winter
- The conflict message names the time in Detroit and says "Reload to see their change."

### Preview (pure)

- Next 10 Occurrences of a weekly Series from today
- Skipped dates are not in the preview; a cancelled Override shows its badge
- A `COUNT` Series with 3 dates left shows 3
- A one-time Event in the past shows "No upcoming dates"
- A bad Advanced rule shows the engine's message

### Input parsing (pure)

- Title and a valid Calendar are required
- A timed end before its start and an all-day end date before its start date are refused
- The CTA needs both a label and an http(s) URL
- The image URL is accepted when `isEventImageUrl` accepts it, when it equals the stored URL, or
  when it is empty; any other URL is refused
- Advanced rule text from an Editor is refused
- A rule with no Occurrence is refused; the stored start is the first Occurrence

### Split plan (pure)

- Split on an Occurrence date ends the old Series the day before and starts the new one on that date
- Split between two Occurrences starts the new Series on the next Occurrence
- Split before the first Occurrence changes the Series in place
- Split after the last Occurrence is refused
- A `COUNT` Series: old gets `UNTIL`, new gets the remaining `COUNT` with the same repeat
- Same repeat keeps the old `UNTIL` on the new Series
- Every-2-weeks Series keeps its weeks with the same repeat and a new time
- Override exactly on the split date moves to the new Series with the new time as its key
- Override before the split date stays, also when it was moved to a later date
- Override on a date that the new repeat does not make is listed as removed
- Skipped dates on or after the split date move; earlier ones stay
- "Stop the Series" sets `UNTIL` and removes later Overrides; refused when no date is left before it

### Writes (PGlite)

- Create makes an approved Event with `created_by`, its Tags, version 1, and one `create` history row
- Create refuses a Tag of the other Calendar and a retired Tag
- An edit does not add a new link to a Tag retired after the form opened
- "All dates" edit changes content and Tags, not timing or rule; version + 1; one `edit` history row
- A content edit of a Series that sends a time change is refused
- A Calendar change clears the Event's Tags
- A retired Tag that the Event already has stays after an edit
- One-time Event edit changes the time, Schedule status, and Schedule note
- Two Editors save the same version: the first wins, the second gets a conflict with the first's time
- A conflict changes nothing and writes no history row
- Split writes both Events, moves Overrides, copies Tags, and writes two history rows
- Split links the new Event to the old one, also for a Series that was already split
- Split with a stale version is a conflict; nothing changes
- A split that fails part way (a bad Tag) leaves both Events as they were
- In-place change keeps the Event id and re-keys its Overrides
- Save Override stores only changed fields, bumps the Event version, writes an `override` row
- An Override with every field equal to the Series removes the row
- An Override on a date that is not an Occurrence is refused
- Clear Override removes the row and writes a `clear-override` row
- Delete hides the Event from the public agenda (`loadOccurrences`)
- A write to a deleted Event is refused with "This Event was deleted."
- Restore by an Admin shows the Event again and writes a `restore` row
- History lists newest first with the Editor name, and "Import" for import rows
- List filters by Calendar, title search (with `%` in the text), and Review status; deleted Events
  only with "Show deleted"

The import tests (`src/import/*.test.ts`) and agenda tests must pass with no change.

## Task order (test-first, one small commit per step)

0. `import-split-guard` — the import tests and the report test, then `write.ts`, `report.ts`.
1. `event-create-edit` (pure part) — rule form tests, then `rule-form.ts` and `describe-rule.ts`.
2. `version-conflict-message` (pure part) — format tests, then `format.ts`.
3. `event-create-edit` — preview tests, then `preview.ts`; input tests, then `event-input.ts`.
4. Write helpers and `createEvent` — PGlite tests, then `write-helpers.ts`, `create-event.ts`.
5. `series-edit-scopes` (content) — tests, then `edit-event.ts` (both edit kinds, Calendar change).
6. `series-edit-scopes` (split) — split plan tests, then `plan-split.ts`; PGlite tests, then
   `split-series.ts`.
7. `occurrence-override-edit` — tests, then `overrides.ts`.
8. `soft-delete-restore` — tests, then `delete-event.ts`.
9. `event-list-admin` and `event-history-view` (reads) — tests, then `queries.ts`.
10. `event-list-admin` — the list page.
11. `event-create-edit` — new and edit pages, form, rule editor, preview, the stand-ins
    (`seams.ts`, `image-upload-field.tsx`), actions.
12. `series-edit-scopes` — scope choice and split panel.
13. `occurrence-override-edit` — the Occurrence page.
14. `soft-delete-restore` and `event-history-view` — delete or restore, history section.
15. Verify — `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (no database).
16. Manual check on Neon dev (below).

## Manual check on Neon dev

1. Copy `/Users/jbell/git/grcodemonkey/bikegr-calendar/.env.local` into the worktree (gitignored).
   Never print, log, or commit its values.
2. `RESEND_API_KEY= pnpm dev`, so the magic link goes to the server console. Log in as a seeded
   Admin through Playwright. The link is not copied into any report.
3. Create a test Event "Test — admin editing" (weekly), check the preview, edit content, split it,
   change and clear one date, see the conflict message (two tabs), delete and restore. Check `/rides`
   after each step. Delete the test Events at the end (soft delete).
4. Never touch production.

## Verification

- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass; the build needs no database.
- No change to `src/engine/types.ts`, the schema, the migrations, or files outside my scope.
- If `admin-people-tags-images` merged first: rebase, import the real `listPickerTags`,
  `ImageUploadField`, and `isEventImageUrl`, delete the stand-ins, and run the checks again.
- No push, no merge.

## Built notes

- The `[id]` routes read `params` and `searchParams` inside `<Suspense>`; `pnpm build` passes with
  no `export const instant = false`.
- The router keeps an earlier page in the DOM (hidden), so a fixed input id can occur twice. `Field`
  gives each input a unique id (`useId`).
- PR #6 merged: the Event form uses the real `listPickerTags` (`@/admin/tags/tags`),
  `ImageUploadField` (`@/admin/images/image-upload-field`), and `isEventImageUrl`
  (`@/admin/images/image-url`); the stand-ins are deleted. The rule "an image URL equal to the
  stored URL is accepted" stays in `event-input.ts`. Tests use `isEventImageUrlForHost` with a fixed
  host.
- Review fixes: a split date before today (Detroit) is refused for every mode ("Pick today or a
  later date. To change one past date, use One date."); a split or in-place change cannot run over
  the predecessor's last date or the successor's first date (`loadSplitBounds`); re-keyed
  Overrides drop a time slot of the other kind; a database error is a `failed` result.
