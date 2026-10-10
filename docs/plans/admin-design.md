# Plan — Admin design

Stream: `admin-design`. Terms follow [CONTEXT.md](../../CONTEXT.md). Status: plan only, waits for
Jeremy's "go". Branch `admin-design`, from `origin/main` at f24c1e2.

## Context

Real Editors use the admin on bikegr.org. Jeremy's screenshot of `/admin` shows plain browser
styling: a text title with an orange focus box, black underlined nav links, a gray "Sign out"
button, and a bullet list of links. He wants the admin "a little prettier".

The public side already has the bikegr.org look (Chivo and Open Sans, the brand tokens in
`src/app/globals.css`, pill buttons, the GGRBC logo in `public/brand/`, and the AA rule in
[design.md](../design.md) "Brand and colors"). The admin uses none of it: blue `bg-blue-700`
buttons, `rounded` gray borders, and Tailwind grays.

**No behavior change.** This stream changes markup and CSS only, plus small read queries for the
dashboard. Server Actions, write logic, validation, and the session checks do not change. Admin
pages stay dynamic (they read the session). `src/auth/**` and `src/app/login/**` belong to the
Google login stream and do not change.

### What I found on the current pages (local run, test data)

"Before" screenshots of every admin page at 1280 and 375 px are in the worktree, in
`.playwright-mcp/admin-design-before/` (git ignores the folder).

| Page | Problem |
|---|---|
| All | No logo, no brand fonts on headings, blue buttons, black underlined links. Nav does not show the current page. The Review queue count is plain text "(1)". |
| All, 375 px | Header wraps into three loose rows. |
| `/admin` | Only a bullet list. No counts, no next step. |
| Events list, 375 px | A 5-column table: 33 px horizontal scroll, the dates wrap into 4 lines. |
| Editors, 375 px | 132 px horizontal scroll of the whole page, although the table has `overflow-x-auto`. Cause: `<main>` is a flex item of the root `flex-col` body with `min-width: auto`, so the table's min-content width makes `<main>` wider than the screen. |
| Tags, 375 px | 3 px horizontal scroll (same cause, smaller). |
| Event form | Long, flat form: every field the same weight. The Review panel is the only box. The preview, the Series scopes, and the Series split summary have weak structure. |
| Event page | Review status and Schedule status are plain text or gray chips. The "Dates" list has 20 rows with "Change this date" links, no visual group. |

### Why the title shows a focus box (found)

The CSS is correct: the ring is already on `:focus-visible` only. The cause is the Chrome
focus-visible heuristic together with the App Router:

1. The title and the nav links are in the admin layout. A client-side navigation keeps the layout
   mounted, so the clicked link keeps focus after the new page shows (`document.activeElement` is
   the title link; `:focus-visible` is false).
2. Then any key press on the page (Shift, an arrow key, Space to scroll, Escape) makes Chrome
   apply `:focus-visible` to the element that has focus. Measured with Playwright on the local
   build: click the title, then press Shift, ArrowDown, Space, or Escape: `focus-visible=true`.
   Meta alone and Cmd+Shift+4 do not.
3. After a full page load, nothing has focus (`BODY`), so the box does not show.

So Jeremy clicked the title (or a nav link), then pressed a key, for example to scroll. The same
happens with every nav link. See decision **focus-after-navigation** below.

## Approach

1. **Shared admin UI primitives** in one new module, `src/app/admin/_components/ui.tsx`: class
   helpers and small server-safe components (no `"use client"`), so server pages and client forms
   use the same look. Button variants, input class, field, table, badge, notice and alert, card,
   empty state, page header. The brand tokens come from `globals.css`; no new colors except the
   badge tints below (each checked for AA).
2. **Admin shell:** a white header band with the GGRBC icon and "Calendar admin" in Chivo, the nav
   with `aria-current="page"` and a count badge on the Review queue, the Editor name and role, Sign
   out, and a link to the public calendar. The page body is the page gray `#F2F2F3`, with content
   in white cards. This makes the admin clearly different from the public pages (white) but in the
   same brand. `min-w-0` on `<main>` stops the page scroll at 375 px.
3. **Apply the primitives on every admin page** (Events list and filters, Event form, rule editor,
   preview, Series scopes and split, Overrides, Review queue and Review panel, Tags, Editors and
   invite, history, occurrence page). Phone layouts for every table. Text, labels, roles, and
   element order stay the same, so the tests and screen readers find the same names.
4. **Dashboard on `/admin`:** cards for pending Submissions, Events this week, recent changes, and
   quick links. Three cheap reads (cost below).
5. **Tests:** the existing unit and e2e tests must pass unchanged. A new e2e file checks the nav
   current page, the dashboard counts, and no horizontal scroll at 375 px on every admin page.

### Design tokens for the admin (all AA, measured)

| Use | Colors | Contrast |
|---|---|---|
| Body text | `#424142` (`brand-gray`) on white / on page gray | 10.16:1 / 9.08:1 |
| Muted text (hints, "sent at") | `#5F5E5F` on white / on page gray | 6.46:1 / 5.77:1 |
| Links, nav current underline | `brand-orange-text` `#BF4624` on white | 5.10:1 |
| Primary button (Save, Create Event, New Event, Add Tag, Send invite) | white on `brand-orange-text` | 5.10:1 |
| Approve button | white on `brand-green-text` `#67752E` | 5.05:1 |
| Secondary button (Filter, Open, Skip this date, Retire, Change role) | `brand-gray` text, `brand-divider` border, white | 10.16:1 |
| Danger outline (Delete this Event, Reject, Deactivate) | `#B91C1C` (red-700) text and border on white | 6.47:1 |
| Badge "Pending" | `#78350F` on `#FEF3C7` | 8.15:1 |
| Badge "Approved" | `#4D5822` on `#E9EED3` | 6.45:1 |
| Badge "Rejected" / "Deleted" | `#991B1B` on `#FEE2E2` / `#424142` on `#E5E5E5` | 6.80:1 / 8.07:1 |
| Schedule status badges | the public badge (`amber-900` on `amber-100`) | 8.15:1 |
| Nav count badge | white on `brand-orange-text` | 5.10:1 |
| Focus ring | the existing `:focus-visible` ring, 2 px `brand-orange-text` | no change |

Headings: Chivo 400 (as on bikegr.org), h1 28 px, h2 20 px. Body: Open Sans 400 at 15 px (not the
public 300 weight: forms and tables need more weight to read). Buttons: pills
(`rounded-[300px]`), Chivo, 14 px, at least 40 px high (44 px on a phone).

### Query cost of the dashboard

| Card | Read | Cost |
|---|---|---|
| Pending Submissions: the count, the 3 oldest titles, a link | `listReviewQueue(db, { calendar: null })` (exists) | One query on the partial index `events_review_queue_idx`. The count is `rows.length`. Usually 0 to 10 rows. |
| Events this week: approved Occurrences today to today + 6, at most 8 rows, count, link to each admin Event page | `cachedSnapshot(null)` (exists, `"use cache: remote"`) + `expandSnapshot` (pure) | **Zero database queries** on a cache hit: the same cache entry as the public `/` page. On a miss, the 3 snapshot queries that the public side runs anyway. Shows what riders see (approved, not deleted). |
| Recent changes: the last 8 history entries (when, who, what, Event title) | new `listRecentChanges(db, 8)` in `src/admin/events/queries.ts`: `event_history` join `events` (title) left join `editors`, `order by changed_at desc, id desc limit 8`. Selects only `snapshot->'detail'`, not the full snapshot. | One query. No index on `changed_at` alone (`event_history_event_idx` is `(event_id, changed_at)`), so Postgres reads the table and keeps the top 8 (a top-N sort, no full sort). At the current size (the import plus edits: some hundreds to a few thousand rows) this is under a few ms. If the history grows to 100k rows, add an index on `changed_at` (a migration; not in this stream). |
| Quick links | none | none |

The nav already runs `countPending` on every admin page. The dashboard does not add a second
count: it uses the queue rows. Total for `/admin`: the session read, `countPending` (nav), the queue
query, and the history query.

## Items

- `admin-shell-design` — header with the GGRBC icon and "Calendar admin", nav with
  `aria-current="page"` and the Review queue count badge, Editor name with role, Sign out, a link to
  the public calendar, the phone layout, `min-w-0` on `<main>`, the page gray body, and the fix for
  the focus box after navigation.
- `admin-ui-primitives` — the shared module `src/app/admin/_components/ui.tsx` (button variants,
  input class, field, table, badge for Review status and Schedule status, notice and alert, card,
  empty state, page header). `fields.tsx` keeps its `Field`, `FieldError`, and `inputClass` exports
  (they use the new module), so the client forms keep their imports.
- `admin-pages-design` — apply the primitives on every admin page and component listed in Files
  to change, with phone layouts for the tables.
- `admin-home-dashboard` — `/admin` with the four cards and the new `listRecentChanges` read (with
  a unit test on PGlite, as the other query tests do).
- `admin-design-e2e` — new `e2e/admin-design.spec.ts`: the nav current page, the dashboard counts,
  no horizontal scroll at 375 px; plus an Admin with a session row in `e2e/global-setup.ts`, so the
  test can open `/admin/editors`.
- `design-doc-admin-look` — a short "Admin look" paragraph in `docs/design.md` "Brand and colors"
  (page gray body, white cards, button variants, badge colors with their contrast).

## Files to change

| File | Item | Change |
|---|---|---|
| `src/app/admin/_components/ui.tsx` (new) | `admin-ui-primitives` | Class helpers and components |
| `src/app/admin/layout.tsx` | `admin-shell-design` | Header band, logo, gray body, `min-w-0`, `<main id>` |
| `src/app/admin/admin-nav.tsx` | `admin-shell-design` | Nav with the current page (a small client child that reads `usePathname()`), badge, user block, public link |
| `src/app/admin/admin-nav-links.tsx` (new, client) | `admin-shell-design` | `aria-current` from `usePathname()`; the focus fix (if option A) |
| `src/app/globals.css` | `admin-shell-design` | Only if needed: `[tabindex="-1"]:focus { outline: none }` for the focus target (option A) |
| `src/app/admin/page.tsx` | `admin-home-dashboard` | Dashboard cards |
| `src/admin/events/queries.ts` (+ test) | `admin-home-dashboard` | `listRecentChanges` |
| `src/app/admin/events/page.tsx` | `admin-pages-design` | Page header, Calendar tabs, filter bar, table and phone list, badges, empty state |
| `src/app/admin/events/new/page.tsx` | `admin-pages-design` | Page header, back link |
| `src/app/admin/events/[id]/page.tsx` | `admin-pages-design` | Event header with badges, notices, Dates list card, history table |
| `src/app/admin/events/[id]/occurrence/page.tsx` | `admin-pages-design` | Page header, back link, card |
| `src/app/admin/events/_components/event-form.tsx` | `admin-pages-design` | Form sections in cards, primary button |
| `src/app/admin/events/_components/fields.tsx` | `admin-pages-design` | Field look from the shared module; Tag picker as chips |
| `src/app/admin/events/_components/rule-editor.tsx` | `admin-pages-design` | Rule editor, end choices, Skipped dates chips |
| `src/app/admin/events/_components/occurrence-preview.tsx` | `admin-pages-design` | Preview card, Schedule status badges |
| `src/app/admin/events/_components/series-editor.tsx` | `admin-pages-design` | Scope choice as selectable cards, split summary as a notice |
| `src/app/admin/events/_components/override-form.tsx` | `admin-pages-design` | Buttons, card |
| `src/app/admin/events/_components/review-panel.tsx` | `admin-pages-design` | Review panel card, Approve / Reject / Delete as spam buttons |
| `src/app/admin/events/_components/pending-review.tsx` | `admin-pages-design` | Layout only |
| `src/app/admin/events/_components/save-status.tsx` | `admin-pages-design` | Notice and alert |
| `src/app/admin/events/_components/delete-restore.tsx` | `admin-pages-design` | Danger zone card |
| `src/app/admin/review/page.tsx` | `admin-pages-design` | Page header, tabs, table and phone list, empty state |
| `src/app/admin/tags/page.tsx`, `tag-forms.tsx` | `admin-pages-design` | Calendar cards, table and phone layout, buttons, messages |
| `src/app/admin/editors/page.tsx`, `editor-forms.tsx`, `invite-form.tsx` | `admin-pages-design` | Invite card, table and phone layout, badges, buttons |
| `src/admin/images/image-upload-field.tsx` | `admin-pages-design` | Classes only (file button with `file:` variants, Remove button). Only the admin uses it. |
| `e2e/admin-design.spec.ts` (new), `e2e/global-setup.ts`, `e2e/fixture.ts` | `admin-design-e2e` | New checks; an Admin and its session row |
| `docs/design.md` | `design-doc-admin-look` | Admin look paragraph |

Not changed: `src/app/admin/**/actions.ts`, `src/admin/**` logic, `src/auth/**`, `src/app/login/**`,
the public pages and `src/app/_components/**` (the admin imports nothing new from them, except the
logo file path).

## Sketches

Desktop header and dashboard (1280 px):

```
+----------------------------------------------------------------------------------+
| (o) Calendar admin                         Public calendar ->   E2E Admin  Admin  |
|                                                                        [Sign out] |
|  Events   Review queue (3)   Tags   Editors                                       |
|  ======                                                                          |
+----------------------------------------------------------------------------------+
  page gray
  Calendar admin                                   [ New Event ]  [ Review queue ]
  +---------------------------+  +-------------------------------------------------+
  | Waiting for review     3  |  | This week                                    5  |
  | Oldest: Gravel Ride (2 d) |  | Tue Oct 13  6:00 pm  E2E Tuesday Ride            |
  | Vital Streets Commission  |  | Tue Oct 13  9:00 am  E2E Commission Meeting      |
  | Open the Review queue ->  |  | Thu Oct 15  6:30 pm  E2E Thursday Ride  [Cancelled]
  +---------------------------+  +-------------------------------------------------+
  +-------------------------------------------------------------------------------+
  | Recent changes                                                                |
  | 3:12 pm Oct 10   E2E Editor   Edited        E2E Tuesday Ride                  |
  | 2:58 pm Oct 10   Submitter    Submitted     Thursday Gravel Group Ride        |
  +-------------------------------------------------------------------------------+
```

`(o)` is the GGRBC icon (30 px). `======` is the current-page underline in `brand-orange-text`.
`(3)` is a pill badge; its accessible name stays "Review queue (3)" (hidden parentheses), so the
existing e2e test `/Review queue \(\d+\)/` still passes.

Phone (375 px):

```
+-----------------------------------+
| (o) Calendar admin       [Sign out]|
| E2E Admin · Admin    Public cal -> |
| Events  Review queue (3)  Tags  Editors |
+-----------------------------------+
| Events                [New Event] |
| +-------------------------------+ |
| | E2E Tuesday Ride   [Approved] | |
| | Rides & Events · Every Tue    | |
| | Next: Tue, Oct 13, 6:00 pm    | |
| +-------------------------------+ |
```

## Open decisions

### 1. `header-look` — the color of the admin header

- **A. White header band, page gray body, white cards (recommended).** The same white header as the
  public pages, with the icon and "Calendar admin". The gray body and white cards show that this is
  the admin, and they give forms and tables a clear edge.
- B. Dark header (`brand-gray` `#424142`, white text, 10.16:1). The admin looks very different from
  the public side, so an Editor always knows where they are. Cost: a second header look to keep.
- C. All white, like the public pages. Least work; the admin and the public side look alike.

### 2. `nav-on-phone` — the nav at 375 px

- **A. One row of links that wraps if needed (recommended).** No JavaScript, every link visible.
  "Events Review queue (3) Tags Editors" fits in about 300 px at 14 px. An Editor (no
  "Editors" link) has more room.
- B. A `<details>` menu, as on the public header. Hides the links behind one more tap.
- C. A row that scrolls sideways inside its own box. No wrap, but links can be off screen.

### 3. `phone-tables` — tables at 375 px

- **A. Mixed (recommended).** Events list: a card list on a phone and the table from `sm` up (the
  same pattern as the Review queue today; the rows are read-only, so two markups are safe). Tags and
  Editors: one markup, where each row becomes a stacked block on a phone, with a small label before
  each value (`data-label`). These rows have forms with `id`s and action state, so two copies would
  give duplicate ids and two states. The table keeps explicit ARIA roles (`role="table"`, `row`,
  `cell`), because Safari drops table semantics when the display changes. History: stays a
  table (3 short columns fit).
- B. Card list on a phone for every table (two markups). Simple CSS, but duplicate ids in Tags and
  Editors.
- C. Keep tables and scroll them sideways inside their own box (the page does not scroll).
  Least work; hard to use on a phone.

### 4. `focus-after-navigation` — the focus box after a click in the header

- **A. Move focus to the page content after each client-side navigation (recommended).** A small
  client component in the nav: when `usePathname()` changes, it calls
  `main.focus({ preventScroll: true })` on `<main tabIndex={-1}>` (no outline on that focus
  target). Then the header link does not keep focus, so a later key press shows no box. It also
  acts like a full page load for keyboard and screen-reader users: the next Tab goes into the page,
  not back through the header. A query change (filters, `?calendar=`) keeps the same path and does
  not move focus.
- B. Blur the header link after a mouse click only. Keyboard users keep their place in the nav.
  Smaller change, but a keyboard user must Tab through the header again on each page.
- C. No change. The browser behavior is correct by the spec; the box shows only after a key press.

### 5. `button-colors` — the button variants

- **A. Primary = white on `brand-orange-text`; Approve = white on `brand-green-text`; danger = red
  outline; secondary = white with a gray border (recommended).** All pills. Orange matches the
  public CTA and DONATE; green for Approve says "go" and stays different from Save.
- B. Primary = white on `brand-green-text` everywhere (green as the admin color, orange only for
  links). Calmer, but Approve and Save look the same.

### 6. `dashboard-recent-changes` — include recent changes on `/admin`

- **A. Include it (recommended).** One query with `limit 8`; cheap now (see the cost table). An
  Editor sees what other Editors changed.
- B. Leave it out. Pending and this week only; no new query.

### 7. `e2e-ports` — run the e2e tests next to another builder

The e2e app port (3100) and host port (4100) are fixed in `e2e/fixture.ts`. The Google login builder
on this machine may use them too. The database URL can already change (`E2E_DATABASE_URL`).

- **A. Read `E2E_APP_PORT` and `E2E_HOST_PORT` from the environment, with the same defaults
  (recommended).** Two lines in `e2e/fixture.ts`. CI and `pnpm test:e2e` do not change.
- B. No change. I run the e2e tests only when port 3100 is free.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm build` (no output filtered for secrets is printed; the
  build output has none).
- `pnpm test --hookTimeout=120000 --testTimeout=120000` (no `--`): all tests pass, plus the new
  `listRecentChanges` test.
- `pnpm test:e2e` against my own Docker Postgres (`docker compose -p bikegr-admin-design`, port
  55471, test values only): all existing tests pass unchanged, plus `e2e/admin-design.spec.ts`:
  - "the nav marks the current page": on `/admin/events`, the Events link has
    `aria-current="page"` and the others do not; the same on Review queue, Tags, and Editors (as
    the Admin).
  - "the dashboard counts match the pages": the pending count equals the rows in the Review queue;
    the "This week" count equals the approved Occurrences in the fixture week.
  - "no horizontal scroll at 375 px": for each admin page (home, Events, New Event, a Series, a
    one-time Event, a pending Event, an occurrence page, Review queue, Tags, Editors),
    `document.documentElement.scrollWidth <= innerWidth`.
  - "no focus box after a header click": click a nav link, press Shift, and the active element is
    not a header link (only with option A or B of `focus-after-navigation`).
- "After" screenshots of every admin page at 1280 and 375 px, next to the "before" ones, for
  Jeremy's review.
- Contrast: every new color pair is in the token table above with its measured ratio (WCAG
  formula); none under 4.5:1 for text under 24 px.
- Keyboard: Tab through the header, a form, and the Review panel; every control shows the ring;
  the heading order (h1, then h2, then h3) does not change on any page.
