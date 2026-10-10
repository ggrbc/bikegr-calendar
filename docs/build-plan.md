# Bike GR Calendar — Build plan

Decided 2026-10-09. Terms follow [CONTEXT.md](../CONTEXT.md); details are in [design.md](design.md).

Four milestones, in this order. Each one ends with a demo. The cutover target is set outside this
plan.

**Why the engine is first:** every view, the Feeds, the import check, and the admin read from the
Occurrence engine. If it is wrong, all of them are wrong.

## Engine and import

- Scaffold the Next.js app. Connect Vercel, Neon, and Resend, all on `web@bikegr.org`.
- DNS in Squarespace: `calendar.bikegr.org` CNAME to Vercel; Resend verified on the root
  `bikegr.org` with `send.bikegr.org` (CNAME) and `resend._domainkey.bikegr.org` (DKIM), which do not
  touch the Google Workspace root SPF. Do this first — magic-link login waits on Resend's domain
  check.
- Drizzle schema: Calendars (config), Events, Overrides, Tags (per Calendar, with slugs), Editors,
  `event_history`.
- **Occurrence engine, test-first (Vitest):** expand `RRULE` + `EXDATE`s for a window in
  `America/Detroit` wall-clock time; apply Overrides; derive `rescheduled`; carry Schedule status and
  Schedule note. Cover DST changes, all-day events, and Overrides that move an Occurrence out of or
  into the window.
- **Tockify import, test-first:** status prefixes to Schedule status; rule inference per Series with
  the "expands to the exact original list" check; Calendar assignment; Tag cleanup; image copy to
  blob storage; upsert by Source ID.
- **Demo:** the real Bike GR data, both Calendars, in a plain agenda page.

## Admin

- Magic-link login (Auth.js), invites, `admin` and `editor` roles, deactivate. Seed the three first
  Admins.
- Event create and edit with Calendar, Tags, image upload and resize, CTA.
- Series edit scopes: this Occurrence (Override), all (content only), this and following (Series
  split, see [ADR 0001](adr/0001-time-and-rule-changes-by-series-split.md)).
- Schedule status and Schedule note on Occurrences; soft delete and Admin restore.
- `event_history` snapshots; `version` check with a clear conflict message.
- Tag management per Calendar: add, rename (slug stays), merge, retire.
- **Demo:** an Editor reviews the 15 imported Series in the admin.

## Public side and Embed

- Agenda view per Calendar (the standalone switcher was built, then removed on 2026-10-10).
- Filters in the URL: Tags (AND), Day filter (OR within days), text search, date range.
- Schedule status badges and notes; Event detail page with JSON-LD; 410 for deleted Events.
- Add to calendar for one Occurrence (`.ics`, Google, Outlook).
- ICS Feeds: per Calendar, all, and per filter; expanded, stable UIDs.
- Embed script with `data-calendar` and `postMessage` auto-resize. Playwright smoke tests for the
  agenda and the resize. Test on a hidden Squarespace page, on desktop and on mobile.
- **Demo:** both Embeds on the hidden Squarespace page.

## Submissions and cutover

- Public form with `?calendar=` preselect, Tags from that Calendar, and simple repeat.
- Turnstile, honeypot, per-IP rate limit (Postgres).
- Review queue across both Calendars, with Calendar column and filter.
- Emails: new Submission to all active Editors; approve or reject to the Submitter.
- **Cutover:**
  1. Run the import again; fix conflicts with Editor review by hand.
  2. Swap the Squarespace code block on `/events` (Calendar `rides`) and on `/make-a-difference`
     (Calendar `advocacy`).
  3. Point "Submit Your Ride" and the Advocacy "add event" link at the new form, with `?calendar=`.
  4. Tell Tockify Feed subscribers the new Feed URLs.
- **Demo:** a test Submission from the live `/events` page reaches the Review queue and is approved.

## Defaults (not discussed; change if needed)

- Tests: Vitest for the engine and the import; Playwright smoke for the agenda and the Embed.
- Rate limit stored in Postgres; no new service.
- The new-Submission email goes to all active Editors.
