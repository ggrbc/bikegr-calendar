# Plan — Public side and Embed

Stream: `public-side-and-embed`. Milestone: "Public side and Embed" in
[build-plan.md](../build-plan.md). Terms follow [CONTEXT.md](../../CONTEXT.md).

Status: **approved 2026-10-10** (all seven recommendations), with two changes from Jeremy: this stream
adds the `invalidatePublicEvents()` calls to the admin Server Actions itself (after rebase), and the
proxy decides both 404 and 410 (the blocking-route spike failed; see "410 Gone"). Built on branch
`public-side-and-embed`.

## Context

The plain agenda (`/`, `/rides`, `/advocacy`) shows approved Occurrences for 8 weeks, with badges
and Schedule notes. It has no filters, no detail page, no Feeds, and no Embed. This stream adds the
rest of the public side for cutover parity with Tockify: filters in the URL, the Event detail page
with JSON-LD, Add to calendar, ICS Feeds, the Squarespace Embed, and the Calendar switcher.

Two other streams build the admin at the same time (`admin-event-editing`,
`admin-people-tags-images`). This stream does not touch `src/admin/**`, `src/app/admin/**`,
`src/auth/**`, `src/import/**`, or the schema. `src/engine/types.ts` does not change.

## Items

- `public-filters-in-url` — one shared, tested filter model (parse, serialize, match) for Tags, Day
  filter, text search, and date range; used by the pages, the Feeds, and the Embed.
- `event-detail-page` — one Occurrence's page with schema.org `Event` JSON-LD, badge, note, CTA,
  image, location, Tags, Add to calendar; 410 for a deleted Event, 404 for an unknown one.
- `add-to-calendar` — `.ics` download for one Occurrence, plus Google Calendar and Outlook links.
- `ics-feeds` — expanded ICS Feeds per Calendar, for all Calendars, and per filter.
- `embed-script` — `embed.js` for a Squarespace code block: an iframe of an embed view, auto-resize
  by `postMessage`, filters passed through, narrow mobile column.
- `calendar-switcher` — Rides & Events | Advocacy | All on the standalone site, with compatible
  filters kept.

## Decisions (approved 2026-10-10: every recommendation below)

### Public caching — recommendation: cached Calendar snapshot, tag invalidation, CDN on Feeds

The agenda pages read `searchParams` (filters), so the page HTML is per request in all options. The
choice is where the database read is cached.

- **A. Dynamic per request (today).** Each page view, Embed view, and Feed poll reads Neon. Simple
  and always fresh. Cost: the Embed is on Bike GR's busiest pages, and steady traffic keeps the Neon
  compute awake (no autosuspend). The free plan allows about 100 CU-hours a month; 0.25 CU awake all
  month is about 180. Check the current Neon limits.
- **B. Cached Calendar snapshot (recommended).** One cached function per Calendar returns the raw
  data (approved, not-deleted Events, their Overrides, their Tags, and the Calendar's active Tags).
  It does not depend on the date, so one entry serves every window and filter. The engine expands
  it per request (cheap, pure).
  - `"use cache: remote"`, so all Vercel instances share the entry. (Plain `"use cache"` is
    in-memory per instance; the Next.js docs say serverless hit rates are low.) Check the Vercel
    Runtime Cache limits on Hobby first. If they do not fit, use plain `"use cache"` (Fluid compute
    keeps instances warm, so hits still happen).
  - `cacheTag("public-events")` and `cacheLife({ stale: 300, revalidate: 3600, expire: 86400 })`.
  - **Admin writes:** `invalidatePublicEvents()` in `src/agenda/cache.ts` calls
    `updateTag("public-events")`, so the Editor sees the change at once. This stream adds the call
    to the admin Server Actions that change an Event, an Override, or a Tag (after rebase on the
    admin PRs). Done for the Tag actions (`revalidateTagPages()` in `src/app/admin/tags/actions.ts`).
  - **Import CLI** (runs outside the app, so it cannot call `updateTag` or `revalidateTag`): after
    an import, the public side is stale for at most 1 hour. The import runs by hand, twice in total
    (now and at cutover). To clear it at once, redeploy: the cache key includes the deployment ID,
    so a new deploy starts empty. Rejected for now: a secret `POST /api/revalidate` endpoint that
    the CLI calls (more surface for little gain; easy to add later).
- **Feeds in both options:** `Cache-Control: public, s-maxage=900, stale-while-revalidate=86400`.
  The Vercel CDN keeps each Feed URL (with its query) for 15 minutes. Calendar apps poll every few
  hours, so a 15-minute delay does not matter.
- The detail page uses the same snapshot (option B) or a direct read (option A).

### 404 and 410 for detail URLs — decided: the proxy decides both

Next.js has no `gone()`. `notFound()` gives 404 (only 401, 403, 404 exist), and a page cannot set its
status code. **Spike result (2026-10-10):** a detail page with `export const instant = false`, no
`<Suspense>`, and `notFound()` after `await params` still builds as a partial prerender: the static
shell of the root layout goes out first, so an unknown URL gets **200** with `noindex` (a soft 404).
With `generateStaticParams`, the first request gets 200 and the second a cached 404 per path. So
neither status can come from the page.

- **Built:** `src/proxy.ts`, matcher `/events/:path*`. It calls `detailGate` → `findOccurrence(db,
  eventId, segment)` (src/agenda/, tested on PGlite): `gone` → 410, `missing` → 404, `found` →
  `NextResponse.next()`. The `/admin` branch is unchanged. Also for the `…/event.ics` path, and for
  RSC requests (`RSC: 1` gets the same 404 or 410).
- The body is a small static HTML page (`noindex`, links to the Calendars). Tried and refused:
  `NextResponse.rewrite(…, { status })` to a styled page — Next.js 16.4 sends the prerendered page
  with 200, and an RSC request gets 307.
- A database error in the proxy does not fail the request: it logs only the error name and code
  and lets the request through; the page then handles it.
- The proxy uses its own handle (`src/agenda/proxy-db.ts`), not `getDb()`: `@/db` imports
  `server-only`, which refuses to load outside the React server bundle.
- The page keeps `notFound()` as a backup (an Event deleted between the proxy check and the render).
- One extra database read per detail request. The detail page therefore reads the database
  directly too (not the cached snapshot): the cache would save little, and the page always agrees
  with the proxy.

### Event detail URL — recommendation: `/events/<eventId>/<start>`, no title slug

- `<start>` is the Occurrence's **original start** (the same key as the Feed UID), written without
  the colon: `2026-10-14T1800` (timed) or `2026-10-14` (all-day). A rescheduled Occurrence keeps its
  URL; the page shows the new time.
- **A. No slug (recommended):** `/events/7c9e…/2026-10-14T1800`. Stable; a title change never breaks
  or redirects a link. Search engines read the title from the page and the JSON-LD.
- **B. With a title slug:** `/events/7c9e…/2026-10-14T1800/tuesday-night-ride`. Easier to read when
  shared. A wrong or old slug gets a 308 to the canonical URL. More code, small SEO gain.
- Canonical: `https://calendar.bikegr.org/events/<eventId>/<start>` (absolute, in `metadata`).
  Filtered agenda pages have the unfiltered Calendar page as canonical; Embed views are `noindex`
  with the standalone page as canonical.

### Embed contract — recommendation below; one `next.config.ts` change needs approval

```html
<script src="https://calendar.bikegr.org/embed.js" data-calendar="rides" async></script>
<script src="https://calendar.bikegr.org/embed.js" data-calendar="advocacy"
        data-filters="tag=non-drop&day=tue" async></script>
```

- **Attributes:** `data-calendar` = `rides` | `advocacy` | `all` (default `rides`; a bad value
  gives `rides` and a console warning). `data-filters` = a query string in the same format as the
  page URL (see "Filter model"), parsed by the same parser. One attribute, not one per filter, so
  the Embed never needs a change when a filter is added.
- **Host URL:** the script also passes the host page's own `tag`, `day`, `q`, `from`, `to` query
  values to the iframe (they replace `data-filters`), so `bikegr.org/events?day=tue` works as a
  shared link. When a rider changes a filter in the iframe, the iframe reports its query and the
  script updates the host URL with `history.replaceState` (only those five keys; other keys stay).
  Recommendation: yes. Other choice: no host URL sync (filters inside the iframe are not
  shareable).
- **Resize protocol (iframe → host only):**
  - `{ type: "bikegr-calendar:resize", height: <number> }` from a `ResizeObserver` on the embed
    root element (not on `<html>`: the root layout has `h-full`, so `<html>` height follows the
    iframe and the height would never shrink).
  - `{ type: "bikegr-calendar:location", search: "<query string>" }` after each navigation inside
    the iframe.
  - The iframe sends with target origin `"*"`: the data is public (a height and a public query),
    and the iframe cannot know the host origin for sure. The iframe listens to no messages, so
    there is no inbound attack surface.
  - The host script accepts a message only if `event.origin` equals the origin of its own `src`
    (`new URL(document.currentScript.src).origin`) **and** `event.source` is that iframe's
    `contentWindow` (more than one Embed on a page works). Height must be a finite number from 0 to
    50 000; the script sets `height = ceil(value) + "px"`.
  - On a `location` message, if the top of the iframe is above the viewport, the script scrolls it
    into view (the rider applied a filter at the bottom of a long list).
- **Iframe:** `width: 100%`, `border: 0`, start height 600 px, `title="Bike GR Calendar"`,
  `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox
  allow-forms"` (no top navigation), `referrerpolicy="strict-origin-when-cross-origin"`.
- **Links inside the Embed:** detail pages open in a new tab on `calendar.bikegr.org`
  (`target="_blank"`). The SEO stays on the calendar domain, and the Squarespace page stays open.
  Other choice: an embed-styled detail view inside the iframe (more routes and states).
- **Allowed host origins (`frame-ancestors`) on `/embed/*` only:** `'self' https://www.bikegr.org
  https://bikegr.org https://*.squarespace.com` (the Squarespace editor and preview frame the page
  from `*.squarespace.com`). Plus the value of `EMBED_EXTRA_FRAME_ANCESTORS` (for the local test
  host, `http://localhost:4000`; empty in production). Trade-off: any Squarespace site can frame the
  Embed; the Embed is read-only public data, so clickjacking gains nothing.
- **Where the header is set:** a page cannot set response headers, so the header goes in
  `next.config.ts` `headers()`. **This needs your approval** (the brief says ask first). I also
  propose `frame-ancestors 'none'` on every other path (it protects the admin from clickjacking);
  tell me if you want that, or only the Embed rule.
- `embed.js` is a static file in `public/` (plain JavaScript, no build step, about 100 lines). It
  finds its own `<script>` with `document.currentScript`, else the first
  `script[src$="/embed.js"]` that has no iframe yet (Squarespace can re-run code blocks). It puts
  the iframe right after the script element.

### Feed URLs and `postponed` STATUS — recommendation: `/feeds/<calendar>.ics`, postponed =
`CANCELLED`

- URLs: `/feeds/rides.ics`, `/feeds/advocacy.ics`, `/feeds/all.ics`, with the filter query:
  `/feeds/rides.ics?tag=non-drop&day=tue`. The pages show the URL as a `webcal://` link and as text
  to copy. `from` and `to` are ignored in a Feed (the window is fixed).
- `postponed` (new date not known):
  - **`CANCELLED` (recommended).** It does not happen at the listed time, so a subscriber's
    calendar must not show it as a normal Event. When the Editor sets the new date, the Override
    makes it `rescheduled`; the same UID comes back as `CONFIRMED` at the new time.
  - `TENTATIVE`. It stays in calendars at a time that is wrong. Some clients show tentative Events
    the same as confirmed ones.
  - Either way, the `SUMMARY` gets the prefix `[Postponed] ` (design.md).

### Rescheduled Occurrence under a Day filter — recommendation: show the short "Rescheduled to" entry

design.md: the Day filter uses the new date. So with `?day=tue`, a ride moved from Tuesday to
Thursday does not match. I recommend that the agenda still shows the short "Rescheduled to Thu,
Oct 16, 6:00 pm" entry on the old Tuesday when the old date matches, so a Tuesday rider sees that the
ride moved. The full entry follows the new date, as design.md says. Feeds have no short entries, so
they follow design.md exactly. Other choice: hide it (strict reading).

## Module layout

```
src/agenda/
  snapshot.ts           CalendarSnapshot type; loadSnapshot(db, calendar | null): the three reads of
                        today's loadOccurrences, plus description, image, updatedAt, and the active
                        Tags of each Calendar. Plain, serializable data.
  occurrence-rows.ts    expandSnapshot(snapshot, window) -> AgendaRow[] (pure; the engine call and the
                        mapping that load-occurrences.ts has today)
  load-occurrences.ts   loadOccurrences(db, window, calendar) = expandSnapshot(loadSnapshot(...))
                        (kept, so its tests and callers stay)
  filters.ts            AgendaFilters; parseFilters(params, today); serializeFilters(filters);
                        matchesFilters(row, filters); filterWindow(filters); switcherFilters(...)
  find-occurrence.ts    findOccurrence(db, eventId, originalStart) -> found | gone | missing
  event-gone.ts         isEventDeleted(db, eventId) for the proxy (only with 410 option A)
  occurrence-url.ts     occurrencePath(eventId, originalStart); parseStartSegment(segment)
  json-ld.ts            eventJsonLd(row, url); jsonLdText(value) (escapes "<")
  site.ts               SITE_ORIGIN "https://calendar.bikegr.org"; UID_DOMAIN "calendar.bikegr.org"
  cache.ts              cachedSnapshot(calendar) ("use cache: remote", cacheTag, cacheLife);
                        invalidatePublicEvents() (only with caching option B)
  agenda-days.ts        (exists) + the "Rescheduled to" entry under a Day filter
  dates.ts              (exists) + filter date defaults
src/feeds/
  utc.ts                wallClockToUtc(LocalDateTime): Date (RFC 5545 DST rule); isoWithOffset(...)
  ics-text.ts           escapeText, foldLine, contentLine(name, params, value), CRLF join
  vevent.ts             occurrenceToVevent(row, { now }) -> content lines
  calendar-file.ts      buildCalendarFile({ name, rows, now }) -> string
  feed.ts               feedWindow(today); parseFeedName("rides.ics"); feed name text
  add-to-calendar.ts    googleCalendarUrl(row); outlookUrl(row); singleOccurrenceIcs(row, now)
src/embed/
  protocol.ts           message types and guards (shared by the iframe side and the tests)
public/embed.js         host script (plain JavaScript)
src/app/
  page.tsx, rides/page.tsx, advocacy/page.tsx      agenda + filters + switcher + Feed link
  _components/agenda-page.tsx, agenda-list.tsx     (exist; take filters)
  _components/filter-form.tsx                      GET form: Tags, days, search, from, to
  _components/calendar-switcher.tsx                Rides & Events | Advocacy | All
  _components/badge.tsx                            shared badge and note
  events/[eventId]/[start]/page.tsx                detail page (blocking, no Suspense)
  events/[eventId]/[start]/event.ics/route.ts      one Occurrence as .ics
  feeds/[feed]/route.ts                            rides.ics | advocacy.ics | all.ics
  embed/rides/page.tsx, embed/advocacy/page.tsx, embed/all/page.tsx   (static folders, as today)
  embed/_components/embed-agenda.tsx, resize-reporter.tsx ("use client")
e2e/
  playwright.config.ts, host/index.html (test host page), agenda.spec.ts, embed.spec.ts
```

Static folders for `/embed/<calendar>`, the same as `/rides` and `/advocacy` today (an unknown
dynamic param gives 200 before `notFound()` under Cache Components; see
[import-writer-and-agenda.md](import-writer-and-agenda.md)).

**Dependencies (dev only):** `ical.js` (Mozilla's RFC 5545 parser, to check the Feed output in
tests) and `@playwright/test` (smoke tests, which design.md asks for). Scripts: `test:e2e`. The
lockfile can conflict with the admin streams; I regenerate it on rebase.

## Filter model and URL format (`public-filters-in-url`)

```ts
interface AgendaFilters {
  tags: string[];        // slugs, lowercase, sorted, unique; AND
  days: Weekday[];       // "sun" … "sat", in week order, unique; OR
  q: string;             // trimmed, spaces collapsed, at most 100 characters
  from: LocalDate;       // inclusive
  to: LocalDate;         // inclusive
}
```

- **URL:** `?tag=non-drop,group-ride&day=tue,thu&q=riverside&from=2026-10-12&to=2026-11-30`. A list
  can also come as repeated keys (`tag=a&tag=b`). Keys have one name (no `tags=` alias).
- **Parse (lenient, never throws):**
  - Tags: lowercase. A slug that is unknown, retired, or of a bad form is **kept**, so it matches
    nothing ("a retired or unknown slug gives no results, no error").
  - Days: unknown values are dropped. All seven days = no Day filter.
  - `from` / `to`: a bad date is ignored (default). Default `from` = today (Detroit); default `to` =
    `from` + 8 weeks − 1 day. `to` before `from` → `to` is ignored. The span is at most 366 days
    (`to` is cut back).
- **Serialize (canonical):** keys in the order `tag`, `day`, `q`, `from`, `to`; lists joined with
  commas; default values left out. So `serialize(parse(x))` is stable, and links compare as text.
- **Match (`matchesFilters(row, filters)`), AND between filters:**
  - Tags: every filter slug is in the row's Tag slugs. Rows carry only active Tags (retired Tags are
    left out in the query), and each Event has only Tags of its own Calendar, so the slug is scoped to
    the Calendar. In All, a slug matches the Tag with that slug in each Calendar.
  - Days: the weekday of the **actual** start date (`timing` after Overrides, wall-clock) is in the
    list. A rescheduled Occurrence uses its new date. A multi-day all-day Event uses its first day.
  - `q`: every word (case-insensitive, accents removed with NFKD) is in the title, location,
    description, or a Tag name.
  - Date range: the window `[from, to + 1 day)` goes to the engine.
- **Calendar switcher (`switcherFilters`)**: `day`, `q`, `from`, `to` stay. A Tag slug stays only if
  an active Tag with that slug is in the target Calendar (All = both Calendars). So switching never
  makes a filter that cannot match.
- **Form:** a plain HTML `GET` form (works without JavaScript): Tag checkboxes (active Tags of the
  Calendar; grouped by Calendar in All), seven day checkboxes, a search box, two date inputs,
  "Apply" and "Clear". In the Embed, the form is in a `<details>` element, closed on narrow screens.

## Event detail page (`event-detail-page`)

- Route `src/app/events/[eventId]/[start]/page.tsx`, `export const instant = false`, no
  `<Suspense>`. The proxy gives the real 404 and 410 first (see "404 and 410 for detail URLs"); the
  page's `notFound()` is only a backup. `generateMetadata` and the page share one
  `findOccurrence` read per request (React `cache`).
- `findOccurrence(db, eventId, originalStart)`:
  - not a UUID, a bad start segment, no row, or Review status not `approved` → `missing` (404;
    pending and rejected Events never leak);
  - `deleted_at` set → `gone` (410, see Decisions);
  - else expand the Event for `[start date, start date + 1 day)` and find the Occurrence with that
    original start. None (not a date of the Series, or an `EXDATE`) → `missing`.
- **Content:** Calendar name; title; badge and Schedule note (the same component as the agenda);
  date and time ("Tuesday, October 14 · 6:00 pm – 9:00 pm"); "Rescheduled from …" or "Rescheduled
  to …" line; location with a "Map" link (Google Maps search URL); image (`<img>` with alt text, the
  Blob URL; `next/image` needs `remotePatterns` in next.config, not worth it here); description as
  plain text (paragraphs at blank lines, URLs made into links with `rel="nofollow noopener"`); Tags
  as links to the filtered Calendar agenda; CTA button; Add to calendar (three links); "Back to
  <Calendar>".
- **Metadata:** `generateMetadata`: title "<title> — <date> — Bike GR Calendar", description from
  the first 160 characters of the description, absolute canonical URL, Open Graph image.
- **JSON-LD** (`<script type="application/ld+json">`, `<` written as `<`, as the Next.js guide
  says):

  ```json
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Tuesday Night Ride",
    "description": "…",
    "startDate": "2026-10-14T18:00:00-04:00",
    "endDate": "2026-10-14T21:00:00-04:00",
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": { "@type": "Place", "name": "Riverside Park", "address": "Riverside Park" },
    "image": ["https://…blob…/events/….jpg"],
    "url": "https://calendar.bikegr.org/events/…/2026-10-14T1800",
    "organizer": { "@type": "Organization", "name": "Greater Grand Rapids Bicycle Coalition",
                   "url": "https://www.bikegr.org" }
  }
  ```

  - `eventStatus` from design.md: scheduled and tentative → `EventScheduled`, cancelled →
    `EventCancelled`, postponed → `EventPostponed`, rescheduled → `EventRescheduled` plus
    `previousStartDate` (the original start).
  - Timed: ISO 8601 with the Detroit offset of that instant (the DST rule below). All-day: dates
    (`endDate` is the inclusive last day). No `location` when the Event has none; no `image` when it
    has none. A zero-length Occurrence has no `endDate`.

## Wall-clock to UTC (shared by Feeds, Add to calendar, and JSON-LD)

`wallClockToUtc(local)` in `src/feeds/utc.ts`. The engine stays in wall-clock time (design.md).

- Take the two Detroit offsets in use around that date (the offset one day before and one day
  after). For each, make the candidate instant, and keep it if `utcToWallClock(candidate)` gives the
  same wall-clock time back.
- **Two candidates** (01:30 on the November change day occurs twice): use the earlier instant (EDT).
- **No candidate** (02:30 on the March change day does not exist): use the offset from before the
  change (EST). 02:30 EST is 07:30Z = 03:30 EDT, so the time moves forward by the length of the gap
  (RFC 5545 3.3.5).
- **UTC, not `VTIMEZONE` (recommendation).** Each `VEVENT` is one Occurrence with no `RRULE`, so
  nothing needs local-time repeats. UTC (`…Z`) works the same in every client. A `VTIMEZONE` block
  is a second copy of the DST rules that we must keep correct, and Outlook is strict about it. Feeds
  add `X-WR-TIMEZONE:America/Detroit` so Google and Apple show the Feed in Detroit time. All-day
  Events use `VALUE=DATE` (no zone).

## ICS writer (`ics-feeds`, `add-to-calendar`)

- **Text escaping** (RFC 5545 3.3.11): `\` → `\\`, `;` → `\;`, `,` → `\,`, a line break (CRLF, LF,
  or CR) → `\n`. Other control characters are removed. `CATEGORIES` escapes each Tag name and joins
  them with a plain comma.
- **Line folding** (3.1): each line is at most 75 octets without its CRLF. Fold with CRLF plus one
  space. Count UTF-8 octets, and never cut inside a code point (or a surrogate pair). Every line
  ends with CRLF, also the last.
- **`VCALENDAR`:** `VERSION:2.0`, `PRODID:-//Bike GR//Bike GR Calendar//EN`, `CALSCALE:GREGORIAN`,
  `METHOD:PUBLISH`, `X-WR-CALNAME` ("Bike GR — Rides & Events", "… (filtered)" with filters),
  `X-WR-TIMEZONE:America/Detroit`, `REFRESH-INTERVAL;VALUE=DURATION:PT6H`, `X-PUBLISHED-TTL:PT6H`.
- **`VEVENT` per Occurrence:**
  - `UID:<eventId>-<originalStart>@calendar.bikegr.org` (original start as stored, e.g.
    `2026-10-14T18:00`).
  - `DTSTAMP` = the time the file is made (`now`, injected in tests). `LAST-MODIFIED` = the latest
    `updated_at` of the Event and its Override. No `SEQUENCE` (there is no single number that grows
    on each change of an Override).
  - `DTSTART` / `DTEND` in UTC. No `DTEND` for a zero-length Occurrence. All-day:
    `DTSTART;VALUE=DATE` and `DTEND;VALUE=DATE` = last day + 1 (exclusive).
  - `SUMMARY`: the title; `[Cancelled] `, `[Postponed] `, or `[Date to be confirmed] ` in front for
    those statuses. No prefix for `rescheduled` (the time already moved).
  - `STATUS`: scheduled → `CONFIRMED`, tentative → `TENTATIVE`, cancelled → `CANCELLED`, postponed →
    `CANCELLED` (see Decisions), rescheduled → `CONFIRMED`.
  - `DESCRIPTION`: badge and Schedule note first (for example "Rescheduled from Tue, Oct 14, 6:00 pm
    — Rain"), then the description, then "Register: <CTA URL>", then the detail page URL.
  - `LOCATION`, `CATEGORIES` (Tag names), `URL` (detail page).
- **Feed route** `src/app/feeds/[feed]/route.ts` (`GET`): an unknown name → 404. It reads the filters
  from `request.nextUrl.searchParams` with the shared parser, takes the window `[today − 30 days,
  today + 365 days)`, loads the snapshot, expands, filters, and writes the file.
  `Content-Type: text/calendar; charset=utf-8`; `Content-Disposition: inline;
  filename="bikegr-rides.ics"`; the Cache-Control header above. A database error → 503 with a short
  text body (no driver message).
- **Single Occurrence** `…/event.ics/route.ts`: the same `VEVENT` and UID (a subscriber who also
  downloads it gets no copy), `Content-Disposition: attachment; filename="<title-slug>.ics"`; 404 or
  410 the same as the page.
- **Google Calendar link:** `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&
  dates=20261014T220000Z/20261015T010000Z&details=…&location=…&ctz=America/Detroit`. All-day:
  `dates=20261014/20261015` (exclusive end). Zero-length: the same time twice.
- **Outlook link:** `https://outlook.live.com/calendar/0/action/compose?subject=…&startdt=
  2026-10-14T22:00:00Z&enddt=…&body=…&location=…&allday=false&path=%2Fcalendar%2Faction%2Fcompose&
  rru=addevent`. All-day: `startdt=2026-10-14&enddt=2026-10-15&allday=true`. One link for
  Outlook.com; Microsoft 365 users can use the `.ics` link (other choice: a second link to
  `outlook.office.com`).

## Embed view and protocol (`embed-script`)

- `/embed/rides`, `/embed/advocacy`, `/embed/all`: the agenda with the filter form, no site chrome
  (no home link, no switcher), `robots: noindex`, canonical to the standalone page. A small "Subscribe"
  link to the Feed and a "Bike GR Calendar" link open in a new tab.
- `resize-reporter.tsx` (Client Component) measures the embed root element and posts the two
  messages (see Decisions). It posts only when the height changes by 1 px or more.
- `src/embed/protocol.ts` holds the message names and the guard `readEmbedMessage(data)` (a
  finite height from 0 to 50 000, a search string under 2 000 characters). The iframe side uses it;
  `embed.js` has its own copy of the same small checks (plain JavaScript, no build), and the
  Playwright test covers both.
- `next.config.ts` `headers()` (after approval):
  `{ source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors
  'self' https://www.bikegr.org https://bikegr.org https://*.squarespace.com <extra>" }] }`.
  `embed.js`: `Cache-Control: public, max-age=300` (a change reaches hosts in 5 minutes).
- **Test host page** `e2e/host/index.html`: served by Playwright's `webServer` from a second origin
  (`http://localhost:4000`), with a Rides Embed and an Advocacy Embed (with `data-filters`), and one
  narrow column (360 px) like the Squarespace mobile layout.
- **Hidden Squarespace page check** (before cutover, on a Vercel deploy):
  1. A Bike GR site admin makes a hidden page (not in navigation) with two code blocks (`rides`,
     `advocacy`). For a preview deploy, `src` points to the preview URL and the preview has
     `frame-ancestors` for `www.bikegr.org`.
  2. Check on desktop and on a real phone: the iframe shows; its height follows the content; no inner
     scroll bar; a filter change resizes and updates the host URL; a detail link opens a new tab;
     `bikegr.org/<hidden>?day=tue` opens filtered.
  3. Check in the Squarespace editor (the `*.squarespace.com` frame) and after an in-site link to
     the page (no full reload).
  4. Screenshots for the demo.

## Calendar switcher (`calendar-switcher`)

- On `/`, `/rides`, `/advocacy`: a `<nav aria-label="Calendars">` with three links, the current one
  with `aria-current="page"`. Each link has the `switcherFilters` query for its target.
- Not in the Embed (an Embed shows one Calendar).

## Rendering on the agenda pages

- The static shell (heading) stays prerendered. The filter form, switcher, Feed link, and agenda are
  inside `<Suspense>`, because they read `searchParams` and the clock (`await io()` before the
  clock, as today).
- With caching option B, `cachedSnapshot(calendar)` replaces the direct read. The `loadAgenda`
  fallback ("Events could not load") stays.
- Rows get `description` and `imageUrl` (for search, the detail page, and the Feeds).

## Built notes (differences from the first plan text)

- **Snapshot Tags:** the snapshot carries the active Tags of both Calendars (not only its own), so
  the Calendar switcher can keep the Tags that the target has. The filter form shows only the
  Calendar's own Tags.
- **Canonical query:** a plain GET form sends every field (`q=&from=…&to=…`). A small Client
  Component (`CanonicalQuery`) replaces the URL with the canonical query after the load (no
  navigation). The Embed reports the same canonical query to the host.
- **Host URL sync** happens only when the page has one Embed (two Embeds cannot share the host
  URL), and not on the first load (the start state does not change the host URL).
- **Off-screen Embed:** Chrome does not hydrate an off-screen cross-origin iframe until it scrolls
  into view. A second Embed below a long first one keeps its start height (600 px) until the rider
  scrolls to it; then it resizes. The Playwright tests scroll each iframe into view, as a rider does.
- **Smoke tests** run on a local Docker Postgres (port 55432, project `bikegr-e2e-public`) with a
  known fixture (`e2e/global-setup.ts`; it refuses a non-local URL). Neon dev is for the manual
  check only, so the tests never write to a shared database.
- **`frame-ancestors`:** `next.config.ts` sends `frame-ancestors 'none'` on every path and the Embed
  list on `/embed/*` (the last matching rule wins). `EMBED_EXTRA_FRAME_ANCESTORS` is read at build
  time; only plain `http(s)://host[:port]` values are kept.

## Test cases

### Filters (pure)

- Parse reads a comma list and repeated keys for Tags and days
- Parse lowercases Tag slugs and keeps an unknown or badly formed slug
- An unknown or retired Tag slug matches no rows and gives no error
- Two Tags match only rows that have both
- Two days match rows on either day
- Day filter uses the Occurrence's wall-clock start date, not its UTC date
- Rescheduled Occurrence matches the Day filter of its new date, not its old date
- Multi-day all-day Occurrence matches only the day it starts
- Text search matches title, location, description, and Tag names, case-insensitive, without accents
- Text search with two words needs both words
- Day, Tags, and text search together are joined with AND
- Default date range is today to eight weeks later
- Bad `from` or `to` falls back to the default; `to` before `from` is ignored
- Date range longer than 366 days is cut back
- All seven days is the same as no Day filter
- Serialize writes keys in a fixed order and leaves out defaults
- Serialize then parse gives the same filters
- Switcher keeps day, search, and dates, and keeps only the Tags that the target Calendar has
- Switcher to All keeps every Tag

### Snapshot and rows (PGlite)

- Snapshot has only approved, not-deleted Events of the Calendar, with Overrides and active Tags
- Snapshot lists each Calendar's active Tags, also Tags with no Events, and not retired Tags
- Snapshot is plain data that survives structured clone (Next.js cache serialization)
- Expanding a snapshot gives the same rows as the old `loadOccurrences` (existing tests still pass)

### Find one Occurrence (PGlite)

- Approved Event with a valid original start is found
- Rescheduled Occurrence is found by its original start and has its new timing
- Deleted Event gives `gone`
- Pending or rejected Event gives `missing`
- Unknown id, a non-UUID id, and a bad start segment give `missing`
- Start that is not a date of the Series, or is an `EXDATE`, gives `missing`
- All-day Occurrence is found by its date

### Detail URL

- Timed original start becomes `2026-10-14T1800`; all-day becomes `2026-10-14`
- Parse of the URL segment gives back the original start; bad segments are refused

### Wall-clock to UTC

- Summer time (EDT) gives UTC minus four hours
- Winter time (EST) gives UTC minus five hours
- A time in the March gap (02:30) moves forward by the gap to 03:30 EDT
- A time that occurs twice in November (01:30) uses the first one (EDT)
- Midnight at the start of a change day converts correctly
- Offset text for JSON-LD is `-04:00` in summer and `-05:00` in winter

### ICS text

- Backslash, semicolon, comma, and line breaks are escaped
- A line of 75 octets is not folded; 76 octets is folded
- Folding counts UTF-8 octets and never cuts inside a multibyte character or an emoji
- Every line ends with CRLF, also the last line
- Every physical line is at most 75 octets

### Feeds and VEVENTs

- Feed parses with ical.js, and each Occurrence is one `VEVENT`
- UID is `<eventId>-<originalStart>@calendar.bikegr.org` and is the same on two runs
- Rescheduled Occurrence keeps its UID, has the new time, and "Rescheduled from" in the description
- Each Schedule status gives its `STATUS`; postponed gives `CANCELLED`
- Cancelled, postponed, and tentative titles get their prefix; scheduled and rescheduled do not
- Schedule note and CTA URL are in the description
- Timed Occurrence has UTC `DTSTART` and `DTEND`, also across the DST change days
- All-day Occurrence has `VALUE=DATE` and an exclusive `DTEND`
- Zero-length Occurrence has no `DTEND`
- Description with commas, semicolons, new lines, and emoji survives a parse with ical.js
- Feed window is 30 days back to 365 days forward
- Feed filter by Tag and by day gives only matching `VEVENT`s
- Feed with a retired Tag slug is a valid empty calendar
- Unknown Feed name gives 404; the response has `Content-Type: text/calendar` and the cache header
- Calendar name says "(filtered)" when filters are set

### Add to calendar

- Google link has UTC dates, the title, the location, and the details
- Google link for an all-day Occurrence uses dates with an exclusive end
- Outlook link has UTC start and end, or `allday=true` with dates
- Single `.ics` has one `VEVENT` with the Feed UID and parses with ical.js

### JSON-LD

- Each Schedule status gives its `eventStatus`
- Rescheduled Occurrence has `previousStartDate`
- Timed dates have the Detroit offset; all-day dates have no time
- No location and no image give no `location` and no `image` keys
- `</script>` in a title or description cannot close the script tag

### Agenda days

- Under a Day filter, the "Rescheduled to" entry shows on the old date when the old date matches
  (only if you choose that option)

### Embed protocol (pure)

- A resize message with a finite height in range is accepted
- A message with a wrong type, a missing height, a negative or huge height, or text is refused
- A location message with a long search string is refused

### Playwright smoke (`pnpm test:e2e`, local Docker Postgres)

- Agenda for Rides shows days, and a Day filter changes the list and the URL
- Calendar switcher keeps the Day filter
- Detail page shows the title and has JSON-LD; an unknown detail URL returns 404
- Embed on the test host page shows an iframe, and its height grows to the content
- Embed iframe height shrinks after a filter with fewer results
- A fake resize message from the host page itself does not change the height
- Embed at 360 px width has no horizontal scroll bar
- Host URL gets the filter after a change in the iframe, and a host URL with `?day=tue` opens the
  Embed filtered
- Embed response has the `frame-ancestors` header

## Task order (test-first, one small commit per step)

1. **Spike: blocking detail route** — empty `events/[eventId]/[start]/page.tsx` with
   `instant = false` and `notFound()`; check that `pnpm build` passes and that the status is a real
   404. If not, stop and report.
2. **Snapshot and rows** — tests, then `snapshot.ts`, `occurrence-rows.ts`; `load-occurrences.ts`
   uses them.
3. `public-filters-in-url` — filter tests, then `filters.ts`.
4. **Wall-clock to UTC** — tests, then `utc.ts`.
5. **ICS text** — add `ical.js`; tests, then `ics-text.ts`.
6. `ics-feeds` — VEVENT and calendar-file tests, then `vevent.ts`, `calendar-file.ts`, `feed.ts`,
   and the Feed route.
7. `add-to-calendar` — link and single `.ics` tests, then `add-to-calendar.ts`.
8. **Find one Occurrence and detail URL** — PGlite tests, then `find-occurrence.ts`,
   `occurrence-url.ts`.
9. `event-detail-page` — JSON-LD tests, then `json-ld.ts`, the page, and the `.ics` route.
10. **410** — `event-gone.ts` tests and the proxy branch (option A), or the "removed" 404 text and
    the design.md change (option B).
11. `calendar-switcher` and the filter form on the three agenda pages; the Feed link.
12. **Caching** — `cache.ts` (option B); tell the admin streams about `invalidatePublicEvents()`.
13. `embed-script` — protocol tests; embed views, resize reporter, `public/embed.js`,
    `next.config.ts` headers (after approval).
14. **Playwright** — add `@playwright/test`, the config, the test host page, the smoke tests.
15. **Verify** — `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (no database). Then a
    manual check on Neon dev (copy `.env.local`, never print its values), `pnpm test:e2e`, and
    Playwright MCP screenshots of the agenda, a filtered view, a detail page, and the test host page
    at desktop and 375 px widths.
16. **Hidden Squarespace page check** — after a deploy; Jeremy or a Bike GR site admin makes the
    page. The checklist is above.

## Verification

- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass; the build needs no database.
- Feeds parse with ical.js in the tests; one Feed from Neon dev also imports into Google Calendar or
  Apple Calendar by hand (by URL on a deploy, or as a file locally).
- `curl -I` shows 404 for an unknown detail URL, 410 for a deleted Event (option A), and the
  `frame-ancestors` header on `/embed/rides`.
- Playwright smoke tests pass locally; screenshots of the test host page at desktop and mobile
  widths.
- No change to `src/engine/types.ts`, the schema, or the admin, auth, and import code. No push, no
  merge.
