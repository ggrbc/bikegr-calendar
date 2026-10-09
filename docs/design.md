# Bike GR Calendar — Design

Status: decided in design discussion, 2026-10-09. Not yet built.

Terms follow [CONTEXT.md](../CONTEXT.md).

## Goal

Replace the Tockify calendar (https://tockify.com/bikegr/agenda), embedded at
https://www.bikegr.org/events, with a custom app that has the same public features, a public
submission form with a Review queue, and logins for several Editors.

## Scope

- **Single tenant.** One calendar, for Bike GR only. No tenant IDs, per-tenant theming, billing, or
  custom domains. Theme lives in config.
- **Several Editors** with their own logins.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js (App Router) — admin UI, public views, Embed, and Feeds in one deployable |
| Database | Postgres (Neon) |
| ORM | Drizzle or Prisma (open item) |
| Auth | Auth.js — magic-link email, optional Google |
| Email | Resend |
| Images | Blob storage (Vercel Blob or R2), resized on upload |
| Hosting | Vercel |
| Recurrence | `rrule` (npm) |

At Bike GR's volume, Vercel, Neon, and Resend should stay at or near free tiers. Check current limits
before committing.

## Event model

- **Series are stored as rules.** An Event has an optional `RRULE` plus `EXDATE`s. Occurrences are
  expanded when a query runs, for the requested window only. Never materialize one row per date.
- **Overrides** are rows keyed by `(event_id, original_start)` that change or cancel one Occurrence.
- **Times are wall-clock time + IANA zone** (`America/Detroit`), not UTC only. A 6 pm Tuesday ride
  stays at 6 pm across DST. All-day events store a date only.
- **Status:** `pending` | `approved` | `rejected`. Only `approved` Events are public.
- **Audit fields:** `created_by`, `updated_by`, `reviewed_by`, each with a timestamp. Public
  Submissions have no `created_by`; they carry Submitter name and email instead.
- **History:** an `event_history` table stores a JSON snapshot for each change.
- **Optimistic concurrency:** a `version` column. If two Editors save the same Event, the second save
  fails with a clear message instead of a silent overwrite.
- **Source ID:** nullable; holds the Tockify event ID for imported Events.

## Editors

- **Invite only.** No public sign-up. An Admin enters an email; the invite sends a magic link.
- **Roles:**
  - `admin` — invite and deactivate Editors, change settings, plus everything an Editor does.
  - `editor` — create, edit, delete Events; approve, edit, or reject Submissions.
- **Deactivate, never hard-delete** Editors, so audit trails keep their names.
- Optional later: "claimed by" marker on the Review queue, if the queue gets busy.

## Public side

- **Views:** agenda (primary), month grid, cards (Tockify's "pinboard").
- **Filters:** Tags, text search, date range. All filter state is in the URL, so filtered views can be
  shared and embedded.
- **Event detail page** with schema.org `Event` JSON-LD, so search engines index Events on the
  calendar's own domain.
- **Add to calendar:** per-Event `.ics` download and Google / Outlook links.

## Embed

A script tag in a Squarespace code block injects an iframe.

- Full CSS isolation from Squarespace.
- Auto-resize via `postMessage` from the iframe to the host script.
- Trade-off: no SEO for the host page; the Event detail pages carry the SEO instead.

Rejected for v1: a web component with Shadow DOM (Squarespace CSS and JS can leak in; more to test).

## Submissions and Review queue

- The public form writes an Event with status `pending`. Editors can edit it before they approve.
- **Fields:** the Tockify set (title, start and end, all-day, location, description, image, Tags,
  CTA label and URL) plus Submitter name and email (never public).
- **Spam control:** Cloudflare Turnstile, a honeypot field, a per-IP rate limit.
- **Email:** notify Editors of a new Submission; notify the Submitter on approve or reject.

## Feeds

- ICS feed of approved Occurrences — whole calendar and per filter (e.g. per Tag).
- Optional: RSS.

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

### Field mapping

| ICS | Our model |
|---|---|
| `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL` | title, description, location, link |
| `CATEGORIES` | Tags |
| `X-TKF-FEATURED-IMAGE` | image — **copy into our blob storage**; the Tockify CloudFront URLs will stop working when the subscription ends |
| `X-TKF-PROMOTION-BUTTON;label=…:<url>` | CTA label + URL (264 Occurrences have one) |
| `X-TKF-CUSTOM-PREVIEW` | short summary / excerpt |
| `DTSTART` / `DTEND` (UTC) | convert to wall-clock time in `America/Detroit` |
| `DTSTART;VALUE=DATE` | all-day event |
| UID `<eventId>` | Source ID |

### Approach

1. **Safe to run again.** Upsert by Source ID. Editors keep using Tockify during the build, so the
   import runs again at cutover.
2. **Rebuild each Series.** Group Occurrences by `<eventId>`; infer the rule from the dates.
   - Rides look seasonal (about 109 weekly Occurrences over 3 years, not 156). Try forms such as
     `FREQ=WEEKLY;BYDAY=TH;BYMONTH=4,5,6,7,8,9,10`; confirm months from the data.
   - Missing weeks inside a season become `EXDATE`s.
   - **Check:** the rule must expand to exactly the original Occurrence list. If it does not, import
     that Event as separate one-time Events and flag it for manual review.
   - Occurrences whose title, location, or time differs from the rest of their Series become Overrides.
3. **Tag cleanup.** Drop weekday Tags (Monday … Sunday); day of week is derived from the date and can
   be a filter. 113 Occurrences have an empty category.
4. **No history.** Import only what the feed has. Decided: history before 2026-09 is not needed.
5. With 15 Series, an Editor reviews each one in the admin UI after import. Do not over-engineer rule
   inference.

## Out of scope for v1

- Multi-tenant support.
- Sync from organizers' Google Calendars (ICS import with UID matching, updates, deletes, polling).
- Redirects from old Tockify detail URLs (they are on Tockify's domain; we cannot redirect them).
- Event history before 2026-09.

## Open items

- Drizzle or Prisma.
- Calendar domain (e.g. `calendar.bikegr.org`) — needed for the Embed and for SEO on detail pages.
- Who at Bike GR are the first Admins.
- Final Tag list after cleanup.
