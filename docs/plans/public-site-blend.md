# Plan — Blend into bikegr.org

Stream: `public-site-blend`. Terms follow [CONTEXT.md](../../CONTEXT.md). Approved by Jeremy ("go"),
2026-10-10. Built on branch `public-site-blend`.

## Context

Jeremy's feedback on production: remove the Calendar switcher; remove the dashes from Tag names;
"filters are not filtering" (the Apply buttons were invisible because a stale Vercel build cache
dropped the new CSS classes; the new deploy is correct, but he expects the Tockify behavior); and
the calendar must blend into the Squarespace site. Jeremy also answered Q45 = A (Day filter covers
the whole span) and Q44 = A (prefixed host URL keys).

## Items

- `remove-calendar-switcher` — no Rides & Events | Advocacy | All pills on any page or in the
  Embed. The routes stay. The component, `switcherFilters`, and their tests are gone.
- `tag-names-without-dashes` — the import names a new Tag with spaces ("Group-Ride" becomes "Group
  Ride"); the slug keeps its dashes. Data migration `drizzle/0001_tag-names-without-dashes.sql`
  renames the existing Tags the same way. Idempotent; slugs do not change; a Tag whose new name
  another Tag of the same Calendar already has stays as it is (comment in the migration). Jeremy runs
  it on production (`pnpm db:migrate`); tests run it on PGlite only. Note: "Non-Drop" also becomes
  "Non Drop".
- `filters-apply-on-change` — a day or Tag checkbox, or a date, applies at once (client-side
  navigation to the canonical URL from the shared parser and serializer); the search applies on
  Enter; Clear goes to the plain page. Without JavaScript, the Apply button submits the GET form. The
  "Apply filters" button inside the Filter control is gone.
- `embed-host-key-prefix` (Q44 = A) — the host URL uses only `bgr-tag`, `bgr-day`, `bgr-q`,
  `bgr-from`, `bgr-to`; `embed.js` maps them to the short keys. The host's own `q` is never read or
  deleted. The calendar site and the Feeds keep the short keys.
- `day-filter-covers-span` (Q45 = A) — the Day filter matches every wall-clock day an Occurrence
  covers; a timed Occurrence counts for a later day only if it still runs after 06:00 that day.
  Grouping under the start date does not change.
- `site-design-blend` — header, flat toolbar, cards, detail page, 404/410 page, and Embed in the
  bikegr.org look.

## Decision made while building: agenda pages are blocking

The e2e test "without JavaScript, the Apply button submits the filters" showed that the agenda never
appeared without JavaScript: a streamed `<Suspense>` boundary needs JavaScript to replace its
fallback. So `/`, `/rides`, `/advocacy`, and `/embed/*` are now blocking (`instant = false`, no
`<Suspense>`): the first HTML has the events. Trade-off: no prerendered shell, so the first byte
waits for the (cached) snapshot. It also helps bots that do not run JavaScript.

## What I measured on www.bikegr.org (2026-10-10, /volunteering and /)

| Part | Value |
|---|---|
| Page background | `#F2F2F3` |
| Text color | `#424142` (rgb 66, 65, 66) |
| Header | white, 118 px high (82 px on a 375 px phone), logo 347 × 75 px on the left |
| Nav links | Open Sans 300, 15.84 px, `#424142`; Get Involved, Resources, News, Events, About Us, Contact |
| DONATE | Chivo 400, 12.8 px, uppercase, letter-spacing 0.256 px, padding 15.36 px 25.6 px, radius 300 px, background `#D14C27`, white text |
| h1 / h2 | Chivo 400; h2 46.72 px, line height 60 px |
| Body text | Open Sans 300, 15.84 px, line height 30.4 px (about 1.92) |
| Phone header | icon + "GGRBC" and a two-line menu button |

- The logo is an image on the Squarespace CDN. The calendar draws its own mark (green circle, white
  bicycle) and the name in Chivo, so it does not depend on a file that Bike GR can replace.
- Header links: Get Involved → /volunteering, Resources → /maps (the first item of each folder),
  News, Events → /events, About Us, Contact, DONATE → /donate, all on www.bikegr.org. On a phone the
  links are in a `<details>` menu.
- Colors that differ: the site's orange is `#D14C27` (the calendar's brand orange token is
  `#D04C27`; behind white text the calendar uses the AA variant `#BF4624`, Q43). The text gray token
  is now the measured `#424142`.

## Screenshots

In the worktree, `.playwright-mcp/`: `blend-rides-1280.png`, `blend-rides-375.png`,
`blend-advocacy-1280.png`, `blend-advocacy-375.png`, `blend-detail-1280.png`, `blend-detail-375.png`,
`blend-embed-host-1280.png`, `blend-embed-host-375.png`; bikegr.org for comparison:
`bgr-site-home.png`, `bgr-site-volunteering.png`, `bikegr-org-375.png`.

## Remaining differences from bikegr.org

- The logo is drawn (mark + name in Chivo), not the site's image file; letter shapes differ a little.
- No dropdown menus in the header (each folder links to its first page).
- Buttons and the DONATE pill use the darker AA orange `#BF4624`, not the site's `#D14C27`.
- Tag names on Neon dev still have dashes until the migration runs there.
- The Embed's gray matches bikegr.org sections that use the page gray; a white Squarespace section
  would show the Embed as a gray block.

## Test cases

- Import: "a new Tag's name has spaces instead of dashes; the slug keeps its dashes"
- Migration: '"Group-Ride" becomes "Group Ride", and the slugs do not change'; "a second run changes
  nothing"
- Filters: "Fri–Sun all-day Occurrence matches every day it covers: sat yes, mon no"; "18:00 to
  01:00 matches its start day only"; "18:00 to 07:00 matches both days"; "a 7-day span matches every
  day"; agenda "under a Day filter, a Fri–Sun Occurrence shows for sat, still under its start date";
  Feed "a Feed with day=sat includes a Fri–Sun all-day Event"
- e2e: "no Calendar switcher on the public pages; the routes stay"; "agenda for Rides …" (one
  checkbox click filters); "the search applies on Enter, and Clear removes every filter"; "without
  JavaScript, the Apply button submits the filters"; "Embed height shrinks after one checkbox click,
  and the host URL gets bgr- keys"; "a host URL with ?bgr-day=tue opens the Embed filtered; the
  host's own q is not read"; "short filter keys on the host URL are not Embed keys"
