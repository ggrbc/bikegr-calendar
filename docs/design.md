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
| Email | Resend, verified on the root `bikegr.org`, sending from `notifications@bikegr.org` |
| Images | Blob storage (Vercel Blob or R2), resized on upload |
| Spam control | Cloudflare Turnstile, honeypot, per-IP rate limit stored in Postgres (one shared module, `src/rate-limit`, also used for magic links) |
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
- **Mail domain:** Resend is verified on the root `bikegr.org` and sends from
  `notifications@bikegr.org`. Its records are `send.bikegr.org` (CNAME, the bounce and SPF
  subdomain) and `resend._domainkey.bikegr.org` (DKIM). They do not touch the root SPF record of
  Bike GR's Google Workspace mail. The root `_dmarc` is `p=none`.
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
  | `postponed` | Postponed | `CANCELLED` (decided 2026-10-10) | `EventPostponed` |
  | `rescheduled` | Rescheduled to / from | `CONFIRMED` | `EventRescheduled` |

  `rescheduled` is derived: an Override moved the start. It shows on the old date ("Rescheduled to
  Thu 6 pm") and on the new date ("Rescheduled from Tue 6 pm").

  `postponed` maps to ICS `CANCELLED`: it does not happen at the listed time, so a subscriber's
  calendar must not show it as a normal Event. When the Editor sets the new date, the Override makes
  it `rescheduled`, and the same UID comes back as `CONFIRMED`. The Feed `SUMMARY` gets the prefix
  `[Postponed] ` (also `[Cancelled] ` and `[Date to be confirmed] ` for those statuses).
- **Schedule note:** optional short public text on an Occurrence, shown with any Schedule status.
- **Audit fields:** `created_by`, `updated_by`, `reviewed_by`, each with a timestamp. Public
  Submissions have no `created_by`; they carry Submitter name and email instead.
- **Soft delete:** `deleted_at`, `deleted_by`. A deleted Event is hidden from the public side, the
  Feeds, and default admin lists; its history stays; an Admin can restore it. Its detail URL returns
  **410 Gone**. Only whole Events are deleted; one Occurrence is cancelled instead. (The proxy gives
  the 410 and the 404 of detail URLs: a page cannot set its status code under Cache Components.)
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
- Tag names have no dashes (Q47 = A, 2026-10-10): the import and migration 0001 make each dash a
  space ("Non-Drop" becomes "Non Drop"); the slug keeps its dashes. An Editor can rename a Tag in the
  admin, and the import never overwrites an existing Tag's name.

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
- **Magic-link rate limit:** 20 link requests per hour per IP (an IPv6 address counts by its /64),
  and 5 per hour per active Editor's email. A limited request gets the same answer as a sent link,
  with no email, so the login page still does not show who is an Editor. Admin invites count too.
  **The limit fails open:** if it cannot run (for example, the `rate_limits` migration has not run
  yet, or the database connection fails), the link is sent and one log line gives the error class
  and code (no email, no IP). So the limiter can never lock out all Editors. The rate-limit module
  itself is strict (it throws); each caller decides, and Submissions fails closed. Details:
  [plans/magic-link-rate-limit.md](plans/magic-link-rate-limit.md).
- Later: "claimed by" marker on the Review queue; per-Calendar Editor access (one join table, default
  all Calendars).

## Public side

- **Views:** agenda at cutover. Month grid and cards (Tockify's "pinboard") after cutover.
- **Calendar in the URL:** `calendar.bikegr.org/rides/…`, `/advocacy/…`, and `/` for all. No
  Calendar switcher on the pages (removed 2026-10-10, Jeremy): each page shows one Calendar, and
  bikegr.org links to each one.
- **Filters apply at once** (Tockify behavior): a day or Tag checkbox, or a date, changes the list at
  once; the search applies on Enter. Without JavaScript, the Apply button submits the form.
- **Agenda pages and the Embed are blocking** (Q46 = A, 2026-10-10): `instant = false` and no
  `<Suspense>`, so the first HTML has the Events, for visitors without JavaScript, search engines,
  and link previews. The cost is small: the data is one cached snapshot read.
- **Filters:** Tags, Day filter, text search, date range. All filter state is in the URL, so filtered
  views can be shared and embedded.
  - Between filters: AND (`?day=tue&tag=non-drop` = non-drop rides on Tuesday).
  - Within Tags: AND (both Tags must match).
  - Within days: OR (`?day=tue,thu` = Tuesday or Thursday).
  - The Day filter matches every wall-clock date that an Occurrence covers (decided 2026-10-10): an
    all-day Event from Friday to Sunday shows for Fri, Sat, and Sun. **06:00 rule:** a timed
    Occurrence counts for a later day only if it still runs after 06:00 on that day, so a 6 pm to
    1 am ride is a Tuesday ride only, and a ride to 7 am also counts for the next day. A rescheduled
    Occurrence uses its new dates. The agenda still lists each Occurrence under its start date.
    The agenda also shows the short "Rescheduled to …" entry on the old date when the old date
    matches the Day filter, so a rider who looks for that weekday sees that it moved (decided
    2026-10-10). Feeds have no short entries.
- **Schedule status badges** and Schedule notes show in the agenda and on the detail page.
- **Event detail page** with schema.org `Event` JSON-LD (including `eventStatus`), so search engines
  index Events on the calendar's own domain.
- **Add to calendar:** `.ics` download and Google / Outlook links for the one Occurrence the rider
  clicked. "Add the whole Series" is a later option.

## Brand and colors

The public calendar and the Embed use Bike GR's brand (measured on bikegr.org and the Tockify
calendar): Chivo for headings, titles, date lines, and buttons; Open Sans for body text. Colors are
Tailwind theme tokens in `src/app/globals.css`.

**Decided 2026-10-10 (Jeremy):** the brand orange and green are too light for small text on white or
on the page gray (WCAG AA needs 4.5:1 for normal text, 3:1 for large text of 24 px and more). So each
has a darker AA variant:

| Token | Color | On white | On page gray `#F2F2F3` | White text on it | Use |
|---|---|---|---|---|---|
| `brand-orange` | `#D04C27` | 4.43:1 | 3.96:1 | 4.43:1 | Large titles (24 px and more), borders, decoration |
| `brand-orange-text` | `#BF4624` | 5.07:1 | 4.56:1 | 5.07:1 | Small titles, links, CTA button background |
| `brand-green` | `#98AC43` | 2.52:1 | 2.26:1 | 2.52:1 | Borders, decoration, the no-image placeholder |
| `brand-green-text` | `#67752E` | 5.05:1 | 4.51:1 | 5.05:1 | Tags, small text, outline buttons |

Rule: text under 24 px and every button background use a `-text` variant; the brand colors are only
for large titles, borders, and decoration. Text gray is `#424142` (measured on bikegr.org), the
divider `#E5E5E5`.

**Blend into bikegr.org** (measured on www.bikegr.org, 2026-10-10; details in
[plans/public-site-blend.md](plans/public-site-blend.md)): page gray `#F2F2F3`; a white header
(118 px, 82 px on a phone) with the logo and a text nav in Open Sans 300 at 15.84 px; headings in
Chivo 400 (not bold); body text Open Sans 300 at 15.84 px with a line height of about 1.9; buttons
are pills (`border-radius: 300px`) in Chivo with white text. Flat sections, no boxed panels, no hard
borders. The site's own orange is `#D14C27` (white text on it about 4.4:1); the calendar keeps the AA
variant `#BF4624` behind white text. The standalone pages have a bikegr.org-like header with Bike
GR's own logo files (`public/brand/`; the icon is also the app icon and the card placeholder for an
Event with no image; every link goes to www.bikegr.org); the Embed has no header and uses the page gray, the color of the
Squarespace section around it.

**Admin look** (decided 2026-10-10, Q53 = A, Jeremy; plan:
[plans/admin-design.md](plans/admin-design.md)): a white header with the GGRBC logo and "Calendar
admin", the nav with the current section marked (`aria-current`, orange underline) and the Review
queue count as a badge; the page gray body with white cards. The shared parts are in
`src/app/admin/_components/ui.tsx`. Buttons are pills in Chivo: primary white on `brand-orange-text`
(5.10:1), Approve white on `brand-green-text` (5.05:1), danger a red-700 outline (6.47:1), secondary
a gray outline (border `#8A898A`, 3.48:1). Badges: Pending `#78350F` on `#FEF3C7` (8.15:1), Approved
`#4D5822` on `#E9EED3` (6.45:1), Rejected `#991B1B` on `#FEE2E2` (6.80:1), Deleted and Retired
`#424142` on `#E5E5E5` (8.07:1); Schedule status badges use the public badge. Muted text `#5F5E5F`
(6.46:1 on white). After a client-side navigation to a new path, focus moves to `<main>`, so a
header link that was clicked does not keep focus (Chrome shows the focus ring on it after the next
key press).

## Embed

A script tag in a Squarespace code block injects an iframe. The script takes the Calendar as an
attribute (`data-calendar="advocacy"`).

- `/events` shows `rides`; `/make-a-difference` shows `advocacy`.
- Full CSS isolation from Squarespace.
- Auto-resize via `postMessage` from the iframe to the host script.
- **Filters in the host page URL** (Q44 = A, 2026-10-10): the host URL uses only the keys `bgr-tag`,
  `bgr-day`, `bgr-q`, `bgr-from`, `bgr-to`, so they never clash with the host page's own keys
  (Squarespace uses `?q=`). `embed.js` maps them to the short keys for the iframe. The calendar site
  and the Feeds keep the short keys. Other host keys are never read or changed. The `bgr-` keys go to
  every Embed on the page (by design: a page with two Embeds shows both filtered); only a page with
  one Embed writes filter changes back to its URL, with plain commas (`bgr-day=wed,thu`).
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
- **Decided 2026-10-10 (Q50 = A, Jeremy; plan:
  [plans/submissions-and-review-queue.md](plans/submissions-and-review-queue.md)):**
  - **Order of the checks (Q51 = A):** field check → honeypot (filled: the thank-you page, nothing
    written) → per-IP limits → Turnstile on the server → the limit of all Submissions → image
    (sharp) → write → emails. A field error spends no Turnstile token and no rate limit. The per-IP
    limits come before Turnstile because they protect the siteverify calls. The limit of all
    Submissions counts only Turnstile passes: bots with no pass must not use up the day and close
    the form for real Submitters (a review found that 21 sends with no token from 7 IPs did).
  - **Rate limits:** per IP 3 an hour and 10 a day; all Submissions together 20 a day (it protects
    the Resend quota, which the new-Submission emails and the magic links share). A failed
    rate-limit check refuses the Submission (fail closed) with "try again later".
  - **Turnstile:** `TURNSTILE_SITE_KEY` (a server prop, no `NEXT_PUBLIC_`) and
    `TURNSTILE_SECRET_KEY`. No keys: the form is closed. Cloudflare's always-pass test keys only
    with the opt-in `TURNSTILE_TEST_KEYS=1`, never on Vercel (local `pnpm dev`, e2e). A pass counts
    only for the action `submit` and the hostname of `AUTH_URL` (else the request host).
  - **Image:** one image, sent with the form; sharp runs only after every check passed. Reject and
    Delete as spam remove the blob when no other Event uses it.
  - **No "we got it" email** to the Submitter; the thank-you page says it arrived.
  - **Reject** always sends the email, with an optional reason (at most 500 characters; also in the
    history detail). **Spam goes to Delete as spam**, which sends nothing. An Editor can approve a
    rejected Event (undo).
  - **Edit before approval** is in place, with the full form, also the time and the rule of a
    Series: a pending Event has no public Occurrence and no Override, so ADR 0001 does not apply.
    Series split and Overrides are refused while it is pending. History: `submit` (the Submitter's
    original, no Editor), `edit` per Save, then `approve` or `reject`. Approve waits until the form
    has no unsaved change.
  - **"Submit an Event"** pill on `/rides`, `/advocacy`, and `/` only. Not in the Embed; `/submit`
    keeps `frame-ancestors 'none'` and opens on calendar.bikegr.org.
  - **Submitter data:** the name in the queue; the name and a `mailto:` email on the Event page,
    for Editors only. Kept for the life of the Event; the form says who sees it. **Later stream:**
    a purge of the Submitter name and email (also in the `event_history` snapshots, which copy the
    whole row), for example 12 months after the last date or after a Reject.

## Feeds

- ICS feed of approved Occurrences — per Calendar, all Calendars, and per filter (e.g. per Tag or
  Day filter).
- **Expanded:** each Occurrence is its own `VEVENT` in a window (about 1 month back to 12 months
  forward), as Tockify does. Every client handles it.
- **Stable UID per Occurrence:** `<eventId>-<originalStart>@calendar.bikegr.org`. A rescheduled
  Occurrence updates in place in subscribers' calendars. After a Series split, the later
  Occurrences' UIDs change once (seen as removed and added).
- Schedule status maps to `STATUS` (table above); the Schedule note goes in the description.
- **Wall-clock to UTC at DST changes** (RFC 5545 rule): a time that does not exist (02:30 on the
  March change day) moves forward by the length of the gap (03:30 EDT). A time that occurs twice
  (01:30 on the November change day) uses the first one (EDT). The engine stays in wall-clock time;
  only the Feeds and JSON-LD convert.
- Later: RSS.

Rejected: one `VEVENT` per Series with `RRULE` / `RECURRENCE-ID`. Client support differs (Outlook
especially), and a Series split shows as an edit plus a new Series.

## Tockify import

### Source

Public ICS feed: `https://tockify.com/api/feeds/ics/bikegr` (no auth). Facts checked 2026-10-09:

- 551 Occurrences, **28 distinct Events**; 15 are Series, 13 one-time (top Series: Switchback
  Community Ride, Ada Park Thursday Group Ride, Wednesday Evening Rides — 109 Occurrences each,
  weekly in all 12 months with no gaps; Kent County Road Commission Meeting — 67).
- **Tockify cuts each Series at its own horizon.** The weekly rides stop at 2028-10; the monthly
  and yearly Series run to about 2029-07. The feed end is not the real end of a Series.
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
  Oversight Commission" (#28 and #29, no Tag). #29 runs 7 days (2026-12-14 to 12-21) — most likely
  a data error in Tockify; check both by hand.

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
   import is run again by hand at cutover. **The import never overwrites an Event that an Editor
   changed in the admin** (an Editor history row: edit, split, stop, in-place change, Override,
   delete, restore; or a successor from a split). The report lists each one as "Changed in the
   admin, not updated"; an Editor applies a Tockify change there by hand if it is still needed.
   Volume is low, so there is no freeze mechanism.
2. **Rebuild each Series.** Group Occurrences by `<eventId>`; infer the rule from the dates.
   - Candidates: weekly (with `INTERVAL` and seasonal `BYMONTH`), monthly by nth weekday or last
     weekday (`-1TU`), yearly. Missing dates become `EXDATE`s, at most 25% of the expanded dates.
   - **Check:** the rule must expand to exactly the original Occurrence list, up to the Series' own
     last Occurrence in the feed. If it does not, import that Event as separate one-time Events
     (Source ID `<eventId>/<startMinutes>`) and flag it for manual review.
   - **Open-ended rule:** the import date is an explicit input. A Series whose last Occurrence
     starts more than one year after the import date (strictly after the same date one year later)
     gets no `UNTIL` — that far-away end comes from Tockify's horizon, not from the organizer. Other
     Series get `UNTIL=<last date>T235959` (Detroit wall-clock). The Series split and the Submission
     form write `UNTIL` in the same form. Editors check each end date in the admin review.
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
