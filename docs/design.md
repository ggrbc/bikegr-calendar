# Bike GR Calendar — Design

Status: decided in design discussions, 2026-10-09 (first pass, then a build-plan grilling session).
Not yet built. Build order: [build-plan.md](build-plan.md). Decisions: [adr/](adr/).

Terms follow [CONTEXT.md](../CONTEXT.md).

## Goal

Replace the Tockify calendar (https://tockify.com/bikegr/agenda) with a custom app that has the same
public features, a public submission form with a Review queue, and logins for several Editors.
Tockify is embedded today on two Squarespace pages:

- `https://www.bikegr.org/events` — the whole calendar (full embed on desktop, mini embed on
  mobile), plus a "Submit Your Ride" button to Tockify's submit form.
- `https://www.bikegr.org/make-a-difference` — the same calendar filtered to the `Advocacy` Tag.
  Tockify cannot exclude a Tag, so Advocacy Events also show on `/events`. The new app fixes this.

## Scope

- **One organization, two Calendars.** Rides & Events (`rides`) and Advocacy (`advocacy`), fixed in
  config. Each Event is in exactly one. No tenant IDs, per-tenant theming, billing, or custom
  domains. Theme lives in config.
- **Several Editors** with their own logins. All Editors edit both Calendars.
- **Cutover scope (full parity, Submissions included):** agenda view, filters, Event detail page,
  Add to calendar, both Embeds, ICS Feeds, Editors with roles, Series edit, Submissions with the
  Review queue and emails.
- **After cutover:** month grid view, cards view, RSS, Google login, "claimed by" marker on the
  Review queue, per-Calendar Editor access.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js (App Router) — admin UI, public views, Embed, and Feeds in one deployable |
| Database | Postgres (Neon). Production: `neon-serverless` WebSocket `Pool` at module scope with Vercel `attachDatabasePool`, so interactive transactions work (the HTTP driver cannot stop a batch when a `version` check fails). Any `*.neon.tech` URL (also the dev branch) uses this Pool; local Docker Postgres uses postgres-js. Migrations run by hand (`pnpm db:migrate`), not in the build. |
| Data access | Drizzle (schema in TypeScript, `drizzle-kit` migrations, `sql` tag for hard queries) |
| Auth | Auth.js — magic-link email (Google login after cutover) |
| Email | Resend, sending from a `calendar.bikegr.org` subdomain |
| Images | Blob storage (Vercel Blob or R2), resized on upload |
| Spam control | Cloudflare Turnstile, honeypot, per-IP rate limit stored in Postgres |
| Hosting | Vercel Hobby |
| Recurrence | `rrule` (npm) |
| Tests | Vitest (Occurrence engine, import), Playwright smoke tests (agenda, Embed) |

At Bike GR's volume, Vercel, Neon, and Resend should stay at or near free tiers. Check current limits
before committing.

## Accounts, repo, and domain

- **Bike GR owns every service account** (Vercel, Neon, Resend, Cloudflare, blob store), signed up
  with the `web@bikegr.org` group inbox. Logins live in Bike GR's password manager.
- **Vercel Hobby** is acceptable: Bike GR is a 501(c)(3) and the developer is an unpaid volunteer.
  Hobby has one user; move to Pro only if a second developer joins.
- **Repo:** public, at https://github.com/ggrbc/bikegr-calendar (Hobby can deploy public org repos).
  No secrets in code; they live in Vercel environment variables.
- **App domain:** `calendar.bikegr.org`, a CNAME to Vercel.
- **Mail domain:** a `calendar.bikegr.org` sending subdomain for Resend. Its SPF, DKIM, and bounce MX
  records stay off the root domain, so they do not touch Bike GR's Google Workspace mail. The root
  `_dmarc` is `p=none` with no `sp=`, so the subdomain has no DMARC conflict.
- **DNS** is managed in the Squarespace domain panel. Add the records in the first milestone:
  magic-link login cannot work until Resend verifies the domain.

## Event model

- **Calendar:** every Event has exactly one Calendar (`rides` | `advocacy`).
- **Series are stored as rules.** An Event has an optional `RRULE` plus `EXDATE`s. Occurrences are
  expanded when a query runs, for the requested window only. Never materialize one row per date.
- **Overrides** are rows keyed by `(event_id, original_start)` that change one Occurrence: time,
  location, title, Schedule status, Schedule note.
- **Times are wall-clock time + IANA zone** (`America/Detroit`), not UTC only. A 6 pm Tuesday ride
  stays at 6 pm across DST. All-day events store a date only.
- **Review status:** `pending` | `approved` | `rejected`. Only `approved` Events are public.
- **Schedule status** (per Occurrence, stored on the Override, or on the Event for a one-time Event):

  | Value | Public badge | ICS `STATUS` | schema.org `eventStatus` |
  |---|---|---|---|
  | `scheduled` | none | `CONFIRMED` | `EventScheduled` |
  | `tentative` | Date to be confirmed | `TENTATIVE` | `EventScheduled` |
  | `cancelled` | Cancelled | `CANCELLED` | `EventCancelled` |
  | `postponed` | Postponed | open item | `EventPostponed` |
  | `rescheduled` | Rescheduled to / from | `CONFIRMED` | `EventRescheduled` |

  `rescheduled` is derived: an Override moved the start. It shows on the old date ("Rescheduled to
  Thu 6 pm") and on the new date ("Rescheduled from Tue 6 pm").
- **Schedule note:** optional short public text on an Occurrence, shown with any Schedule status.
- **Audit fields:** `created_by`, `updated_by`, `reviewed_by`, each with a timestamp. Public
  Submissions have no `created_by`; they carry Submitter name and email instead.
- **Soft delete:** `deleted_at`, `deleted_by`. A deleted Event is hidden from the public side, the
  Feeds, and default admin lists; its history stays; an Admin can restore it. Its detail URL returns
  **410 Gone**. Only whole Events are deleted; one Occurrence is cancelled instead.
- **History:** an `event_history` table stores a JSON snapshot for each change.
- **Optimistic concurrency:** a `version` column (`update … where id = ? and version = ?`, then check
  the row count). If two Editors save the same Event, the second save fails with a clear message
  instead of a silent overwrite.
- **Source ID:** nullable; holds the Tockify event ID for imported Events.
- **Predecessor:** nullable link from a Series to the Series it was split from.
- **No separate link or excerpt fields.** The CTA is the only external link. Excerpts are derived
  from the description.

## Series edit

The admin offers three scopes when an Editor changes a Series. See
[ADR 0001](adr/0001-time-and-rule-changes-by-series-split.md).

- **This Occurrence:** writes an Override (including cancel, postpone, tentative, and notes).
- **All Occurrences:** edits content fields only (title, description, Tags, image, CTA, location).
- **This and following:** the only way to change the time or the rule. Makes a **Series split** from
  a date the Editor picks (default today). The old Event ends the day before; the new Event links to
  it as predecessor; Overrides on or after the date move to the new Event.

## Tags

- A **managed list**, per Calendar. Editors add, rename, merge, and retire Tags. Submitters pick from
  the list only.
- Each Tag has a stable **slug** used in URLs. Renaming keeps the slug.
- A filter URL with a retired Tag shows no results, with no error.
- When an Editor moves an Event to the other Calendar, its Tags are cleared.
- The final Tag lists are chosen after the first import, from the real data.

## Editors

- **Invite only.** No public sign-up. An Admin enters an email; the invite sends a magic link.
- **Roles:**
  - `admin` — invite and deactivate Editors, change settings, restore deleted Events, plus everything
    an Editor does.
  - `editor` — create, edit, delete Events and Tags in both Calendars; approve, edit, or reject
    Submissions.
- **First Admins:** jeremy@bikegr.org, bultentom@bikegr.org, nate@bikegr.org. They invite the
  Editors.
- **Deactivate, never hard-delete** Editors, so audit trails keep their names.
- Later: "claimed by" marker on the Review queue; per-Calendar Editor access (one join table, default
  all Calendars).

## Public side

- **Views:** agenda at cutover. Month grid and cards (Tockify's "pinboard") after cutover.
- **Calendar in the URL:** `calendar.bikegr.org/rides/…`, `/advocacy/…`. The standalone site has a
  switcher: Rides & Events | Advocacy | All.
- **Filters:** Tags, Day filter, text search, date range. All filter state is in the URL, so filtered
  views can be shared and embedded.
  - Between filters: AND (`?day=tue&tag=non-drop` = non-drop rides on Tuesday).
  - Within Tags: AND (both Tags must match).
  - Within days: OR (`?day=tue,thu` = Tuesday or Thursday).
  - The Day filter uses the Occurrence's wall-clock date; a rescheduled Occurrence uses its new date.
- **Schedule status badges** and Schedule notes show in the agenda and on the detail page.
- **Event detail page** with schema.org `Event` JSON-LD (including `eventStatus`), so search engines
  index Events on the calendar's own domain.
- **Add to calendar:** `.ics` download and Google / Outlook links for the one Occurrence the rider
  clicked. "Add the whole Series" is a later option.

## Embed

A script tag in a Squarespace code block injects an iframe. The script takes the Calendar as an
attribute (`data-calendar="advocacy"`).

- `/events` shows `rides`; `/make-a-difference` shows `advocacy`.
- Full CSS isolation from Squarespace.
- Auto-resize via `postMessage` from the iframe to the host script.
- Must work in the narrow mobile layout (Tockify uses a separate mini embed there today).
- Test on a hidden Squarespace page before cutover.
- Trade-off: no SEO for the host page; the Event detail pages carry the SEO instead.

Rejected for v1: a web component with Shadow DOM (Squarespace CSS and JS can leak in; more to test).

## Submissions and Review queue

- The public form writes an Event with Review status `pending`. Editors can edit it before they
  approve, including its Calendar.
- **Calendar from the link:** each page's "add event" link opens the form with `?calendar=rides` or
  `?calendar=advocacy`. The form shows the Calendar preselected; the default is `rides`.
- **Fields:** title, start and end, all-day, location, description, image, Tags (from the selected
  Calendar's list), CTA label and URL, plus Submitter name and email (never public).
- **Simple repeat:** "Repeats weekly on [days] until [date]", stored as
  `FREQ=WEEKLY;BYDAY=…;UNTIL=…`. Editors refine the rule (e.g. season months) before they approve.
  The Submitter never sees the words "Series" or "rule".
- **Spam control:** Cloudflare Turnstile, a honeypot field, a per-IP rate limit.
- **Review queue:** one queue for both Calendars, with a Calendar column and filter.
- **Email:** notify all active Editors of a new Submission (Calendar in the subject); notify the
  Submitter on approve or reject.

## Feeds

- ICS feed of approved Occurrences — per Calendar, all Calendars, and per filter (e.g. per Tag or
  Day filter).
- **Expanded:** each Occurrence is its own `VEVENT` in a window (about 1 month back to 12 months
  forward), as Tockify does. Every client handles it.
- **Stable UID per Occurrence:** `<eventId>-<originalStart>@calendar.bikegr.org`. A rescheduled
  Occurrence updates in place in subscribers' calendars. After a Series split, the later
  Occurrences' UIDs change once (seen as removed and added).
- Schedule status maps to `STATUS` (table above); the Schedule note goes in the description.
- Later: RSS.

Rejected: one `VEVENT` per Series with `RRULE` / `RECURRENCE-ID`. Client support differs (Outlook
especially), and a Series split shows as an edit plus a new Series.

## Tockify import

### Source

Public ICS feed: `https://tockify.com/api/feeds/ics/bikegr` (no auth). Facts checked 2026-10-09:

- 551 Occurrences, **29 distinct Events**; 15 are Series (top ones: Switchback Community Ride,
  Ada Park Thursday Group Ride, Wednesday Evening Rides — 109 Occurrences each; Kent County Road
  Commission Meeting — 67).
- **No `RRULE` in the feed.** Tockify expands each Series into separate `VEVENT`s.
- **UID shape:** `TKF/<calendarId>/<eventId>/<startMinutes>/0/0`. All Occurrences of a Series share
  `<eventId>`. `<startMinutes>` is the Occurrence start in minutes since the Unix epoch. Detail URLs
  follow `/bikegr/detail/<eventId>/<startMs>`.
- **Window:** about 5 weeks back (from 2026-09-01) to 2029. Older history is not in the feed.
- Times are UTC (`...Z`). 4 Occurrences are all-day (`VALUE=DATE`).
- **Schedule status is in the title.** Tockify adds a prefix to `SUMMARY`: `**Cancelled** …` (with
  `STATUS:CANCELLED`) and `**Provisional (date to be confirmed)** …` (Tockify's tentative status).
- `URL` is always Tockify's own detail page (551 of 551). `X-TKF-CUSTOM-PREVIEW` is the description
  cut off with "…".
- Advocacy Events: the 5 with the `Advocacy` Tag (Kent County Road Commission, ENTF Transportation
  Committee and Subcommittee, Mobile GR Commission, Southside Creekways) plus "Vital Streets
  Oversight Commission" (#28 and #29, no Tag — most likely duplicates; check by hand).

### Field mapping

| ICS | Our model |
|---|---|
| `SUMMARY` | title, with any `**…**` Schedule status prefix removed |
| `SUMMARY` prefix `**Cancelled**` / `STATUS:CANCELLED` | Schedule status `cancelled` |
| `SUMMARY` prefix `**Provisional (date to be confirmed)**` | Schedule status `tentative` |
| `DESCRIPTION`, `LOCATION` | description, location |
| `CATEGORIES` | Tags (after cleanup) and Calendar (see Approach) |
| `X-TKF-FEATURED-IMAGE` | image — **copy into our blob storage**; the Tockify CloudFront URLs will stop working when the subscription ends |
| `X-TKF-PROMOTION-BUTTON;label=…:<url>` | CTA label + URL (264 Occurrences have one) |
| `DTSTART` / `DTEND` (UTC) | convert to wall-clock time in `America/Detroit` |
| `DTSTART;VALUE=DATE` | all-day event |
| UID `<eventId>` | Source ID |
| `URL` | dropped (Tockify's own page) |
| `X-TKF-CUSTOM-PREVIEW` | dropped (derived from the description) |

### Approach

1. **Safe to run again.** Upsert by Source ID. Editors keep using Tockify during the build; the
   import is run again by hand at cutover, and conflicts with Editor review are fixed by hand.
   Volume is low, so there is no freeze mechanism.
2. **Rebuild each Series.** Group Occurrences by `<eventId>`; infer the rule from the dates.
   - Rides look seasonal (about 109 weekly Occurrences over 3 years, not 156). Try forms such as
     `FREQ=WEEKLY;BYDAY=TH;BYMONTH=4,5,6,7,8,9,10`; confirm months from the data.
   - Missing weeks inside a season become `EXDATE`s.
   - **Check:** the rule must expand to exactly the original Occurrence list. If it does not, import
     that Event as separate one-time Events and flag it for manual review.
   - Remove Schedule status prefixes from titles **before** comparing. Occurrences whose title, location,
     time, or Schedule status differs from the rest of their Series become Overrides.
3. **Calendar.** Events with the `Advocacy` Tag, plus the Vital Streets Events, go to `advocacy`.
   All other Events go to `rides`. The `Advocacy` Tag is dropped.
4. **Tag cleanup.** Drop weekday Tags (Monday … Sunday); the Day filter replaces them. 113
   Occurrences have an empty category.
5. **No history.** Import only what the feed has. Decided: history before 2026-09 is not needed.
6. With 15 Series, an Editor reviews each one in the admin UI after import. Do not over-engineer rule
   inference.

## Out of scope for v1

- Multi-tenant support.
- Sync from organizers' Google Calendars (ICS import with UID matching, updates, deletes, polling).
- Redirects from old Tockify detail URLs (they are on Tockify's domain; we cannot redirect them).
  Subscribers to the Tockify ICS feed must subscribe again to the new Feed.
- Event history before 2026-09.

## Open items

- Final Tag lists for each Calendar, after the first import.
- Vital Streets #28 / #29: duplicate or not.
- ICS `STATUS` for a `postponed` Occurrence: `TENTATIVE` or `CANCELLED` (ICS has no "postponed").
  Put the badge text in the `SUMMARY` either way.
