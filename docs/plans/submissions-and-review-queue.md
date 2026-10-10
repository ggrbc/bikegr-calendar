# Plan — Submissions and Review queue

Stream: `submissions-and-review-queue`. Milestone: "Submissions and cutover" in
[build-plan.md](../build-plan.md). Terms follow [CONTEXT.md](../../CONTEXT.md); the rules are in
[design.md](../design.md) ("Submissions and Review queue"). Branch `submissions-and-review-queue`,
made from `origin/main` (48889ed). Status: built; all ten Open decisions = A (Q50, 2026-10-10).

## Context

Tockify has a public "Submit Your Ride" form today. The new calendar must have the same before the
cutover: a member of the public sends an Event, an Editor reviews it, and only then is it public.
The schema is ready for this: `events.review_status` (default `pending`), `submitter_name`,
`submitter_email`, `reviewed_by`, `reviewed_at`, and the partial index `events_review_queue_idx`
(pending and not deleted, on `created_at`). Every public read already shows `approved` Events only:
`loadSnapshot` (agenda, Embed, Feeds) and `findOccurrence` (detail page, `.ics`, proxy 404). The
admin already has the Event form, the rule editor, the history, the `version` check, and
`revalidateEvents()`.

The parallel stream `magic-link-rate-limit` owns `src/rate-limit/**` (the shared Postgres rate
limit) and `src/auth/config.ts`, and adds migration 0002. This stream does not touch them. It codes
against the fixed contract (`hitRateLimit`, `clientIp`) and rebases when that PR merges.

**Reject and Delete differ** (CONTEXT.md): Reject refuses a Submission; it stays in the admin with
Review status `rejected` and never becomes public. Delete removes an Event that should never have
existed (duplicate, test, spam); it is hidden everywhere and an Admin can restore it. So the Review
page offers both: Reject for a real Submission that does not fit (the Submitter gets an email), and
Delete for spam (no email).

## Approach

1. **A Submission is an Event.** The public form at `/submit?calendar=rides|advocacy` writes one
   `events` row with Review status `pending`, no `created_by`, the Submitter fields, its Tags, and a
   history row `submit` (no Editor). Validation reuses `parseEventInput` from the admin (title,
   timing, CTA with `isHttpUrl`, Tags, image URL), with a public wrapper that adds the Submitter
   fields, length limits, the simple repeat, and refuses Advanced rules.
2. **Spam checks run in a fixed order, in one Server Action:** parse (pure; a field error costs
   nothing) → honeypot (filled: show the thank-you page, write nothing) → per-IP rate limits
   (`hitRateLimit`; they protect the siteverify calls) → Turnstile `siteverify` on the server → the
   rate limit of all Submissions → image (sharp, Blob) → write → emails after the response
   (`after()`). **Changed by Q51 = A (review finding 1):** the limit of all Submissions first came
   before Turnstile, so 21 sends with no token from 7 IPs used up the day and closed the form for
   real Submitters. Now it counts only Turnstile passes; it still protects the Resend quota. The
   domain module gets the checks as injected functions, so Vitest runs it on PGlite with stubs (and
   with the real rate limit).
3. **Review queue** at `/admin/review`: pending Events of both Calendars, oldest first, with a
   Calendar column and filter, and a link with the count in the admin nav. Each row opens the
   existing `/admin/events/[id]` page, which shows a Review panel for a pending Event: Submitter
   details, Approve, Reject (optional reason), Delete (spam).
4. **Edit before approval in place.** A pending Event has no public Occurrence and no Override, so
   ADR 0001's reasons do not apply: the Editor edits every field (Calendar, time, rule) with the full
   Event form. The Series scopes ("This date and later", "One date") and Overrides are refused while
   the Event is pending. Approve and Reject use the `version` claim, write `reviewed_by`,
   `reviewed_at`, and a history row, and call `revalidateEvents()`.
5. **Emails in a new `src/email/` module** (transport + pure composers with plain text and escaped
   HTML; Resend, else the console transport off Vercel). `src/auth/mailer.ts` does not change, so
   this stream does not collide with the auth stream. New Submission → all active Editors (Calendar
   in the subject, link to the queue). Approve or Reject → the Submitter.

No schema change is needed for the recommended options. Decision 3 (option B) or 7 (option C)
would add migration 0003 (after the other stream's 0002).

## Items

- `submission-form` — the public page `/submit?calendar=…` in the bikegr.org look with the site
  header: Calendar (preselected, default `rides`), title, start and end, all day, location,
  description, image, Tags of the selected Calendar, CTA label and URL, Submitter name and email, the
  simple repeat ("Repeats weekly on [days] until [date]"), a privacy line. Writes a pending Event and
  redirects to `/submit/thanks`.
- `submission-spam-control` — Cloudflare Turnstile checked on the server, a honeypot field, the
  per-IP and global rate limits through the `src/rate-limit` contract.
- `review-queue` — `/admin/review` (Calendar column and filter, oldest first), the nav link with the
  count, the Review panel on the Event page, Approve, Reject, Delete as spam; `reviewed_by`,
  `reviewed_at`, history rows; the public cache cleared.
- `pending-edit-in-place` — the full Event form (with the rule editor) for a pending Event, also a
  Series; Series split and Overrides refused while pending.
- `submission-emails` — `src/email/`: the new-Submission email to all active Editors, the approve
  and reject emails to the Submitter; plain text and escaped HTML; console transport in dev and
  tests.
- `submit-event-link` — "Submit an Event" link on the standalone agenda pages (see Open decision 6).

## Files to change

New:

```
src/submissions/
  submission-input.ts       parseSubmissionInput(raw, ctx): the admin parser + Submitter fields,
                            limits, simple repeat (RuleForm weekly, UNTIL), no Advanced rule
  submission-input.test.ts
  submit-event.ts           submitEvent(db, input, deps): the ordered checks and the insert
                            (pending, no created_by, Submitter fields, Tags, history `submit`)
  submit-event.test.ts      PGlite, with stubs for the rate limit, Turnstile, and the Blob store
  turnstile.ts              verifyTurnstile(token, ip, { secret, fetch }): siteverify; fail closed
  turnstile.test.ts
  spam-rules.ts             the RateLimitRule values (Open decision 1), honeypot field name
  review.ts                 approveSubmission, rejectSubmission (version claim, reviewed_*, history)
  review.test.ts
  queue.ts                  listReviewQueue(db, { calendar }), countPending(db)
  queue.test.ts
src/email/
  transport.ts              createEmailTransport(env): resend | console (refused on Vercel);
                            a capture transport for tests
  html.ts                   escapeHtml (shared; same rules as the mailer's)
  submission-emails.ts      composeNewSubmissionEmail, composeApprovedEmail, composeRejectedEmail
  submission-emails.test.ts
  notify.ts                 notifyEditors(db, transport, event), notifySubmitter(...); errors are
                            logged without addresses or content and never fail the write
  notify.test.ts
src/app/submit/
  page.tsx                  site header, Calendar from ?calendar=, picker Tags (cached read)
  submission-form.tsx       client form: FormData, useActionState, Turnstile widget, honeypot
  turnstile-widget.tsx      explicit render; site key from the server as a prop
  actions.ts                submitEventAction (thin: headers, clientIp, env, after())
  thanks/page.tsx           the thank-you page, with a link back to the Calendar
src/app/admin/review/
  page.tsx                  the Review queue
src/app/admin/events/_components/review-panel.tsx
                            Submitter details, Approve, Reject (reason), Delete as spam
src/app/admin/events/revalidate-events.ts
                            revalidateEvents() moved out of actions.ts ("use server" files may
                            export only async functions), so the review actions can call it
e2e/submissions.spec.ts     submit → not public → queue → edit → approve → public
```

Changed:

- `src/admin/events/write-helpers.ts` — `writeHistory` takes `actor: Actor | null` (the Submission
  row has no Editor).
- `src/admin/events/format.ts` — history actions `submit`, `approve`, `reject`; labels "Submitted",
  "Approved", "Rejected" (with the reason); `HistoryDetail.reason`.
- `src/admin/events/queries.ts` — `loadHistory`: the `submit` row shows "Submitter", not "Import".
- `src/admin/events/edit-event.ts` — `editPendingEvent` (every field, rule included; only while
  pending; refuses an Event with Overrides).
- `src/admin/events/split-series.ts`, `overrides.ts` — refuse a pending Event ("Approve or edit the
  Submission first.").
- `src/app/admin/events/actions.ts` — `saveEventAction` scope `pending`; `approveSubmissionAction`,
  `rejectSubmissionAction`; import `revalidateEvents` from the new file.
- `src/app/admin/events/[id]/page.tsx` — for a pending Event: the Review panel and the full
  `EventForm` (also for a Series); no date list, no Series editor.
- `src/app/admin/admin-nav.tsx`, `src/app/admin/page.tsx` — "Review queue (n)" link.
- `src/app/_components/agenda-page.tsx` — "Submit an Event" pill (Open decision 6).
- `.env.example` — `TURNSTILE_SITE_KEY=`, `TURNSTILE_SECRET_KEY=` (names only, with a comment that
  empty means the Cloudflare always-pass test keys, off Vercel only).
- `e2e/global-setup.ts`, `e2e/fixture.ts`, `playwright.config.ts` — an e2e Editor with a database
  session row (Auth.js uses database sessions, so the test sets the `authjs.session-token` cookie;
  no magic link), and test-only env values for the web server: Turnstile always-pass test keys, a
  fixed test `AUTH_SECRET`, `AUTH_URL`.
- `docs/design.md` — record the decisions; `CONTEXT.md` only if a term changes.

Not changed: `src/rate-limit/**`, `src/auth/config.ts`, `src/auth/mailer.ts`, `src/db/schema.ts`
(unless decision 3B or 7C), `src/engine/**`.

## Defaults I chose (not open; change if needed)

- **Public limits** on top of the admin parser: title 200 (as admin), description 5000, location
  200, CTA label 40, Submitter name 100, email 254 (`normalizeEmail` + `isValidEmail` from
  `src/auth/rules.ts`). Name and email are required.
- **Dates:** the start is today or later and at most 18 months ahead. The repeat needs at least one
  day and an end date at most 12 months after the start (no open-ended Submissions). The stored
  rule is `FREQ=WEEKLY;BYDAY=…;UNTIL=<date>T235959` (the same form as the import and the split),
  built with `ruleFormToRrule`.
- **Calendar on the form:** two radio buttons, preselected from `?calendar=` (anything else gives
  `rides`). A change clears the picked Tags, as in the admin.
- **Tags:** active Tags of the Calendar only (`checkTagIds` refuses retired ones). The picker list
  is a small cached read with the `public-events` cache tag, so Tag changes clear it.
- **Turnstile site key** is read on the server (`TURNSTILE_SITE_KEY`) and passed to the widget as a
  prop: no `NEXT_PUBLIC_` value, no rebuild for a key change. On Vercel, a missing key or secret
  closes the form ("Submissions are closed right now"), never open without the check.
- **Turnstile token is single-use.** A field error comes from the pure parse, before `siteverify`,
  so the token is not spent; after any server refusal the widget resets.
- **Honeypot:** a text field named `website`, off screen, `aria-hidden`, `tabIndex={-1}`,
  `autoComplete="off"`. Filled → the same thank-you redirect, nothing written, nothing counted.
- **IP key:** `clientIp(headers)`; null gives the key `unknown` (one shared bucket).
- **Thank-you page** after a redirect (no form resubmit on reload): "Thanks. An Editor will review
  your event. You get an email when it is approved." No Event details on it.
- **New-Submission email** links to `/admin/events/<id>` (the Review panel) and the queue. Links use
  the `AUTH_URL` origin (localhost in dev), else `SITE_ORIGIN`.
- **Emails never fail the write.** The write commits first; `after()` sends. A send error logs one
  line (the email kind and the error class; no address, no content).
- **"Active Editors"** = `deactivated_at is null` (the `canSignIn` rule), also Editors who did not
  accept the invite yet.
- **Approve when all dates are past:** allowed, with a warning line in the Review panel.
- **No cache clear on submit:** a pending Event is not in the public snapshot, and admin pages are
  dynamic. Approve and Reject call `revalidateEvents()`.

## Open decisions

1. **Rate-limit numbers.** Resend's free tier (check the current number) is about 100 emails a day,
   and the magic-link login uses the same quota: a Submission flood must never block Editor logins.
   - A. Per IP 3 an hour and 10 a day; global 20 a day (key `all`). Over a limit: "Too many
     Submissions. Try again in N minutes." (from `retryAfterSeconds`).
   - B. Per IP 5 an hour and 20 a day; no global limit.
   - C. Per IP only, 10 a day.
   - **Recommendation: A.** Bike GR gets a few Submissions a week; the global cap keeps the
     new-Submission emails far under the quota.
2. **Submitter image upload.**
   - A. Upload in the same Server Action as the Submission (one Turnstile check). The browser
     shrinks a file over 4 MB first (`shrinkForUpload`, as the admin); the server runs sharp (WebP,
     1600 px, no metadata) only after the honeypot, the rate limit, and Turnstile pass. Stored at
     `events/<sha256>.webp`. On Reject or Delete-as-spam, the blob is removed when no other Event
     uses its URL (a new `del` on the `BlobStore` interface).
   - B. A as is, but keep the blob after Reject (simpler; an unlisted public URL stays).
   - C. No image from Submitters; an Editor adds it during review.
   - **Recommendation: A.** Tockify takes images, and most rides have one. The checks come before
     any sharp work, and the cleanup stops the store from hosting refused images. Without Blob
     credentials (dev, e2e), the image field shows "Image upload is not set up" and the rest works.
3. **Reject reason in the email.**
   - A. An optional reason box (at most 500 characters); the text goes into the email and into the
     history row (`detail.reason`). No new column.
   - B. As A, plus a `review_note` column (migration 0003), shown on the Event page.
   - C. No reason; a fixed text only.
   - **Recommendation: A.** History already shows it to Editors.
4. **"We got your Submission" email to the Submitter.**
   - A. None. The thank-you page says it; the approve or reject email comes later, after an Editor.
   - B. Send one at once.
   - **Recommendation: A.** An instant email to any typed address lets a bot send our mail to
     strangers (with its own title text), which costs quota and domain reputation. The later emails
     go only after a person acted.
5. **History when an Editor edits before approval.**
   - A. The first row `submit` keeps the Submitter's original. Each Save writes `edit`; Approve is
     its own button and writes `approve`. Approve is disabled while the form has unsaved changes.
   - B. A "Save and approve" button: one transaction, rows `edit` then `approve`.
   - C. One `approve` row whose snapshot has the edited state.
   - **Recommendation: A.** It reuses the save path as is, and the `submit` snapshot always shows
     what the Submitter sent. B can come later if Editors ask for it.
6. **Where the "Submit an Event" link goes.**
   - A. A pill on the standalone pages: `/rides` → `/submit?calendar=rides`, `/advocacy` →
     `?calendar=advocacy`, `/` → `/submit` (default `rides`). Not in the Embed: the Squarespace
     pages have their own link, which the cutover points at the form (`/events` "Submit Your Ride"
     → `?calendar=rides`; a new "Add an event" link on `/make-a-difference` → `?calendar=advocacy`).
   - B. A, plus the same pill in the Embed (opens a new tab; `/events` would then show two buttons
     until the Squarespace one is removed).
   - C. No link in the app; Squarespace links only.
   - **Recommendation: A.**
7. **How the admin shows the Submitter's email, and how long we keep it.** Today it is also copied
   into each `event_history` snapshot (the snapshot holds the whole row).
   - A. Name in the queue; name and a `mailto:` email in the Review panel and on the Event page for
     Editors. Keep the fields for the life of the Event (Editors may need to contact the organizer
     about a later change). The form says: "Only Bike GR Editors see your name and email. We use
     them only about this event."
   - B. A, plus a later purge stream: clear the fields (and the history snapshots) 12 months after
     the Event's last date or after a Reject.
   - C. B with a `submitter_cleared_at` column and a daily cron now (migration 0003, this stream).
   - **Recommendation: A now and B as a follow-up item** after the cutover. Volume is small; the
     purge needs a scheduled job that this stream does not have.
8. **`/submit` inside the Embed iframe, or on calendar.bikegr.org.**
   - A. Only on calendar.bikegr.org, opened in a new tab or the same tab from Squarespace. The CSP
     stays `frame-ancestors 'none'` for `/submit`.
   - B. Also framable at `/embed/submit` (frame-ancestors as the Embed, auto-resize).
   - **Recommendation: A.** Turnstile works best first-party, a long form plus the thank-you step
     is hard to auto-size, and the form stays safe from clickjacking.
9. **Undo a Reject.** A rejected Event stays in the admin (`?review=rejected`).
   - A. An Editor can Approve a rejected Event from its page (the Submitter gets the approve email).
   - B. No undo; the Editor creates a new Event.
   - **Recommendation: A.** One condition more (`pending` or `rejected`), and a misclick is easy to
     fix.
10. **Reject with no email.** With Delete-as-spam there for spam, every Reject sends the email.
    - A. Always send on Reject; spam goes to Delete.
    - B. A checkbox "Send the email to the Submitter" (default on).
    - **Recommendation: A.** Fewer choices; Delete is the spam path in CONTEXT.md.

## Verification

Test first, small commits. Vitest with `--hookTimeout=120000 --testTimeout=120000`.

- **Input (pure):** the admin rules hold (title, timing, CTA `http`/`https` only, Tags shape); name
  and email required and checked; the limits; "weekly on Tue, Thu until <date>" stores
  `FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=<date>T235959`; no days, an end before the start, or an end more
  than 12 months later are refused; Advanced rule text is refused; a start in the past is refused;
  an unknown `?calendar=` gives `rides`.
- **Submit (PGlite, stubs):** a good Submission makes a `pending` Event with no `created_by`, the
  Submitter fields, its Tags, version 1, and one `submit` history row with no Editor; a retired Tag
  or a Tag of the other Calendar is refused; a filled honeypot writes nothing and does not call the
  rate limit or Turnstile; a refused rate limit writes nothing and does not call Turnstile; a failed
  Turnstile writes nothing; the image runs only after all checks; field errors do not call
  Turnstile.
- **Turnstile:** the always-pass and always-fail test secrets with a stubbed `fetch`; a network
  error and a missing secret on Vercel refuse; the IP goes as `remoteip`.
- **Not public:** a pending Event is not in `loadSnapshot` (agenda, Embed, Feeds) and gives
  `missing` from `findOccurrence` (detail page, `.ics`, proxy 404) — tests exist; add one for a
  Submission made by `submitEvent`.
- **Review (PGlite):** the queue lists pending, not deleted Events of both Calendars, oldest first,
  and filters by Calendar; Approve sets `approved`, `reviewed_by`, `reviewed_at`, version + 1, a
  history row, and the Event is then in the snapshot; Reject sets `rejected` and records the
  reason; a stale version gives the conflict message; Approve of an already approved Event is
  refused; a pending Series can change its rule in place; a split and an Override on a pending
  Event are refused; the history shows "Submitter" for the `submit` row.
- **Actions:** approve and reject call `revalidateEvents()` (`invalidatePublicEvents`), as the
  existing action tests check for saves.
- **Emails (pure + capture transport):** subjects (Calendar in the new-Submission subject), the
  queue link, plain text and HTML in each, `<script>` and `&` in a title come out escaped in the
  HTML; all active Editors get it and a deactivated one does not; a send error does not fail the
  Submission; the console transport is refused on Vercel.
- **e2e (local Docker Postgres):** with a stubbed Turnstile script (`page.route` serves a small
  `api.js` that returns Cloudflare's dummy token; the server uses the always-pass test secret, so no
  network): submit a weekly ride on `/submit?calendar=rides` → thank-you page → the title is not on
  `/rides`, `/embed/rides`, or the Feed, and its detail URL is 404 → log in as the e2e Editor →
  `/admin/review` lists it with "Rides & Events" → change its Calendar to Advocacy and save →
  Approve → it shows on `/advocacy`. The honeypot path shows the thank-you page and adds nothing to
  the queue.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- No env values in logs, commits, or output; no Neon, no production.

## Build order and the rate-limit stream

1. `submission-emails` composers and transport (no dependencies).
2. `submission-form` input parser, then `submitEvent` with injected checks (stub rate limit).
3. `review-queue` and `pending-edit-in-place` writes, then the admin pages.
4. `submission-spam-control` Turnstile module and widget.
5. The Server Actions last. `submitEventAction` imports `hitRateLimit` and `clientIp` from
   `@/rate-limit`. If the `magic-link-rate-limit` PR has not merged by then, I ask the main session
   whether to rebase on its branch; the code before this step does not import it.
