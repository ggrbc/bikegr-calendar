# Plan — Occurrence engine and Tockify import (pure part)

Stream: `occurrence-engine-and-import`. Milestone: "Engine and import" in
[build-plan.md](../build-plan.md). Terms follow [CONTEXT.md](../../CONTEXT.md).

## Context

Every view, Feed, and the import check read from the Occurrence engine. This stream builds the engine
against the contract in `src/engine/types.ts` (not changed), and the pure part of the Tockify import:
parse the ICS feed, rebuild each Series, and return plain import records. No database, no network at
run time, no image copy.

## Facts from the feed (downloaded 2026-10-09)

The fixture is `src/import/__fixtures__/tockify-bikegr-2026-10-09.ics` (683 KB, CRLF, folded lines,
no `VTIMEZONE`).

- 551 Occurrences, **28 distinct Events** (design.md says 29; one Event is gone from the feed now),
  **15 Series**, 13 one-time Events.
- Every Series has one title, one location, one description, one image, one CTA, one Tag set, and
  one wall-clock time of day across DST. So Tockify stores wall-clock time. Good for us.
- The three 109-Occurrence rides are weekly with **no gaps, all 12 months** (2026-09 to 2028-10).
  They are not seasonal. I keep the seasonal `BYMONTH` form as a candidate, because Editors still
  edit in Tockify before cutover.
- Expected rule per Series (I checked the date gaps and the nth weekday):

  | Series (Source ID) | Occurrences | Expected rule |
  |---|---|---|
  | Wednesday Evening Rides (1) | 109 | weekly WE; 1 cancelled Override (2026-09-30) |
  | Switchback Community Ride (2) | 109 | weekly TH |
  | Ada Park Thursday Group Ride (61) | 109 | weekly TH |
  | Kent County Road Commission Meeting (3) | 67 | monthly `BYDAY=2TU,4TU` |
  | ENTF Transportation Subcommittee (7) | 33 | monthly `BYDAY=2TU` |
  | Mobile GR Commission Meeting (8) | 34 | monthly `BYDAY=2WE` |
  | ENTF Transportation Committee Meeting (12) | 34 | monthly `BYDAY=4TU` |
  | Hair of the Dog Ride (9) | 3 | yearly Jan 1; 3 tentative Overrides |
  | 11th Annual CDR (59) | 3 | yearly Jul 4 |
  | Luton Loops & Libations (40) | 4 | weekly WE |
  | VBF Tuesday Night Road Ride (52) | 8 | weekly TU |
  | Kentwood Challenger (55) | 8 | weekly WE |
  | Dawn Patrol (56) | 8 | weekly SA; zero-length Occurrences |
  | Gravel Grinders (57) | 7 | weekly MO |
  | Grand Rapids Bike Polo (58) | 2 | all-day, weekly `INTERVAL=2` TH |

  So I expect all 15 to rebuild with an exact-match rule and 0 flagged. The fixture test proves it.
- Schedule status in the feed: 1 `**Cancelled**` (with `STATUS:CANCELLED`), 3
  `**Provisional (date to be confirmed)**`. 547 of 551 `SUMMARY` values start with a space.
- `LOCATION` and `DESCRIPTION` use ICS escapes (`\,` `\;` `\n`). No HTML.
- `X-TKF-PROMOTION-BUTTON` has a second parameter `skip_details=true|false`. I drop it. The URL
  contains `:`, so the value starts after the first `:` that is not inside a quoted parameter.
- All-day `DTEND` is exclusive (`20260901` to `20261001`). Our `endDate` is inclusive, so I subtract
  one day.
- Vital Streets Oversight Commission (28) runs 2026-12-14 13:00 to 2026-12-21 15:00 (7 days). That
  is most likely a data error in Tockify. I report it; I do not fix it.

## Approach

1. **Wall-clock arithmetic only, in the engine.** The engine never converts time zones. It reads a
   `LocalDateTime` as a "floating" date (a JS `Date` whose UTC fields hold the wall-clock fields),
   expands the rule with `rrule` with no `tzid`, and formats the result back. A 6 pm ride is 6 pm on
   every date, because nothing ever adds an offset. DST cannot move it.
2. **Time-zone conversion only at the edge.** The import converts UTC to `America/Detroit`
   wall-clock with `Intl.DateTimeFormat` (built into Node 24, full ICU). The engine needs a conversion
   only for one case: an `UNTIL` value in UTC (`…Z`).
3. **Expand, then apply Overrides, then filter.** Expand the rule from `window.from` minus the
   Event's length (so multi-day Occurrences that start before the window are found) to `window.to`.
   Remove `EXDATE`s. Apply Overrides by original start. Add moved Occurrences whose original start is
   outside that range but whose new slot touches the window. Keep the ones whose original or actual
   slot touches the window. Sort by actual start.
4. **Import as a small pipeline of pure functions:** ICS parse → Tockify Occurrence mapping →
   group by `<eventId>` → per Series: base values, rule inference with the exact-match check (run
   through `expandOccurrences` itself), Overrides, flags → Calendar and Tags → `ImportResult`.
5. **Rule inference stays small** (design.md: "do not over-engineer"). Make a short list of
   candidate rules from the dates, expand each, keep the ones that cover every original date, take
   the missing dates as `EXDATE`s, choose the candidate with the fewest `EXDATE`s, then run the
   exact-match check. If no candidate passes, import one-time Events and flag the Series.

## Library choices

| Need | Choice | Trade-off |
|---|---|---|
| `RRULE` expansion | **`rrule` 2.8.1** (already in design.md) | Mature, small, full RFC 5545 `BYxxx` support, ESM build. Last release 2023, and its `tzid` support has known DST bugs. I avoid `tzid` completely (floating mode, Approach 1), so the bugs do not apply. Its `UNTIL` parser ignores `Z`; the engine normalizes a UTC `UNTIL` to wall-clock first. Rejected: `rrule-temporal` (needs a Temporal polyfill; Node 24 has no `Temporal`), hand-written expansion (more code to test than the engine itself). |
| UTC → wall-clock | **`Intl.DateTimeFormat`** (no dependency) | Correct and built in. Slower than a library, but the import runs 551 conversions once. Rejected: `@date-fns/tz` (one more dependency for one function), Temporal polyfill (large, still a proposal polyfill). |
| ICS parsing | **Small hand-written parser** in `src/import/ics.ts` (no dependency) | About 80 lines: unfold, unescape, parameters. The feed is simple and machine-made; we need only `VEVENT` properties and the raw `X-TKF-*` parameters. Rejected: `ical.js` (good, but a large API for this need, and we still need its raw property access for `X-` parameters); `node-ical` (does network and tz work we do not want). |

New dependency: `pnpm add rrule`. Nothing else.

## Interpretations (decisions inside the contract — tell me if you disagree)

- **`UNTIL`** is read as wall-clock in `America/Detroit`. Accepted forms: `YYYYMMDD` (whole day
  included), `YYYYMMDDTHHMMSS` (floating), and `YYYYMMDDTHHMMSSZ` (UTC, converted to wall-clock). The
  import writes `UNTIL=<last date>T235959` (floating). The Series split and the Submission form must
  write the same form. `types.ts` does not say this; I put it in the engine's module doc comment.
- **`DTSTART` that does not match the rule** is not an Occurrence (`rrule` behavior, and Google
  Calendar behavior). RFC 5545 says it is. The import always starts on a matching date.
- **Event-level Schedule status and Schedule note** apply to every Occurrence as the default; an
  Override wins. For a one-time Event this is the contract. For a Series the import always writes
  `scheduled` / `null`, so nothing changes in practice.
- **Moved and cancelled** (an Override with new timing and a stored status that is not `scheduled`):
  the stored status wins over the derived `rescheduled`. A rider must see "Cancelled".
- **"Touches the window":** a timed Occurrence touches `[from, to)` if it starts before `to 00:00`
  and ends after `from 00:00`; a zero-length Occurrence (Dawn Patrol) touches it if its start is in
  the window. An all-day Occurrence touches it if `startDate < to` and `endDate >= from`.
- **Length** is wall-clock length: a 6–9 pm ride stays 6–9 pm on every date.
- **Override with no matching Occurrence** (start not in the rule, or removed by an `EXDATE`) is
  ignored. `EXDATE` wins over an Override.
- **Sort key:** actual start as a string (`YYYY-MM-DD` before `YYYY-MM-DDTHH:mm`, so all-day first
  on a day), then original start.
- **Source ID of a fallback one-time Event** (a flagged Series that is imported as separate
  Events): `<eventId>/<startMinutes>`, so the upsert by Source ID is still safe to run again. A
  rebuilt Series and a real one-time Event use the plain `<eventId>`.
- **Base values of a Series** are the most common value over its Occurrences (title after prefix
  removal, location, time of day, length). Occurrences that differ in title, location, time, or
  Schedule status become Overrides. If description, image, CTA, or Tags differ (an Override cannot
  hold them), the import uses the most common value and flags `contentDiffers`.
- **EXDATE guard:** a candidate rule may use `EXDATE`s for at most a quarter of its expanded dates.
  Above that, it is not a real rule; flag the Series. (The fixture needs 0 `EXDATE`s.)
- **Tag names** stay as Tockify writes them (`Group-Ride`); slugs are lowercase kebab-case
  (`group-ride`). Editors rename later (the slug stays). Tags belong to one Calendar, so a name used
  in both Calendars gives two Tags.
- **`UNTIL` of a rebuilt Series** is the last date in the feed. The feed stops at its own horizon
  (the 109-Occurrence rides end 2028-10), so Editors must check the end date in the admin review.

## Module layout

```
src/engine/
  types.ts                    contract (not changed)
  wall-clock.ts               parse/format LocalDate(Time) <-> floating Date; add minutes/days;
                              wall-clock length; utcToWallClock (Intl)
  expand-rule.ts              rrule wrapper: original starts of a rule in a range; EXDATEs;
                              UNTIL normalization; clear error for a bad RRULE
  expand-occurrences.ts       expandOccurrences: ExpandOccurrences
  index.ts                    public exports
  *.test.ts                   next to each module

src/import/
  types.ts                    ImportResult, ImportedEvent, ImportedTag, ImportFlag, SeriesReport
  ics.ts                      parseIcs(bytes | string) -> VEvent[] (unfold, unescape, parameters)
  tockify-occurrence.ts       VEvent -> TockifyOccurrence (Source ID, wall-clock Timing,
                              Schedule status from prefix/STATUS, clean title, CTA, image, raw Tags)
  calendar-and-tags.ts        Calendar assignment, Tag cleanup, slugs
  infer-rule.ts               candidate rules, EXDATEs, guard, exact-match check via the engine
  build-series.ts             base values, Overrides, flags, one-time fallback
  import-tockify.ts           importTockify(ics) -> ImportResult (the only entry point)
  __fixtures__/tockify-bikegr-2026-10-09.ics
  *.test.ts
```

Import output (plain records, no DB):

```ts
interface ImportedEvent {
  sourceId: string;              // "<eventId>", or "<eventId>/<startMinutes>" for a fallback
  calendar: CalendarSlug;
  title: string;
  description: string;
  location: string | null;
  tagSlugs: string[];
  imageUrl: string | null;       // Tockify CloudFront URL; the copy is a later task
  cta: { label: string; url: string } | null;
  rule: EventRuleInput;          // eventId === sourceId
}
interface ImportResult {
  events: ImportedEvent[];
  overrides: OverrideInput[];    // eventId === the Series' sourceId
  tags: { calendar: CalendarSlug; name: string; slug: string }[];
  flags: { sourceId: string; title: string; reason: "ruleNotInferred" | "contentDiffers"; detail: string }[];
  series: { sourceId: string; title: string; occurrences: number;
            outcome: "rule" | "flagged"; rrule: string | null; exdates: number; overrides: number }[];
}
```

## Test cases

### Engine — one-time Events and the window

- One-time timed Event in the window gives one Occurrence
- One-time Event outside the window gives nothing
- Window is half-open: an Occurrence on the `to` date is excluded
- One-time Event carries its Schedule status and Schedule note
- Multi-day Event that starts before the window and ends in it is included
- Zero-length Occurrence on the `from` date is included
- All-day one-day Event on the `from` date is included
- All-day multi-day Event that touches the window is included

### Engine — Series expansion

- Weekly Series gives only the Occurrences in the window
- Tuesday 6 pm ride stays 6 pm across the November DST change
- Tuesday 6 pm ride stays 6 pm across the March DST change
- Wall-clock length is kept on every Occurrence
- EXDATE skips one Occurrence
- Wall-clock UNTIL includes the last day
- Date-only UNTIL includes the whole last day
- UTC UNTIL is read as Detroit wall-clock
- COUNT limits the Series
- Seasonal BYMONTH Series skips the winter months
- Monthly Series on the 2nd and 4th Tuesday
- Yearly Series on a fixed date falls on different weekdays
- All-day Series every other Thursday
- Bad RRULE gives a clear error

### Engine — Overrides

- Override of title and location only does not make the Occurrence rescheduled
- Override sets cancelled with a Schedule note
- Override sets tentative, and another sets postponed
- Override with a Schedule note of null clears the Event's note
- Override with the same timing is not rescheduled
- Override that moves the time on the same day is rescheduled
- Rescheduled Occurrence keeps its original timing
- Occurrence moved out of the window still shows when its original slot is in it
- Occurrence moved into the window shows when its original slot is outside it
- Occurrence moved inside the window shows once
- Moved and cancelled Occurrence shows cancelled, not rescheduled
- Override on an EXDATE start is ignored
- Override on a start that is not in the rule is ignored
- Override for another Event is ignored
- Results sort by actual start, so a moved Occurrence sorts at its new slot

### Import — ICS parser

- Unfolds continuation lines
- Joins a fold that splits a multi-byte character
- Unescapes `\n`, `\,`, `\;`, and `\\` in text values
- Reads parameters, including quoted values that contain a colon
- Splits the value at the first colon outside quotes (URL values keep their colons)
- Reads only `VEVENT` components

### Import — Tockify Occurrence mapping

- Reads Source ID and start minutes from the UID
- Converts UTC to Detroit wall-clock in summer (EDT) and in winter (EST)
- Maps `VALUE=DATE` to an all-day Timing with an inclusive end date
- Cancelled prefix gives cancelled and is removed from the title
- `STATUS:CANCELLED` without a prefix gives cancelled
- Provisional prefix gives tentative and is removed from the title
- Leading space in `SUMMARY` is removed
- Promotion button gives a CTA label and URL
- Featured image URL is kept; `URL` and `X-TKF-CUSTOM-PREVIEW` are dropped

### Import — Calendar and Tags

- Advocacy Tag puts the Event in the advocacy Calendar and is dropped
- Vital Streets Oversight Commission goes to advocacy with no Tag
- Other Events go to rides
- Weekday Tags are dropped; an empty category gives no Tags
- Tag slugs are lowercase kebab-case, and each Tag belongs to one Calendar

### Import — rule inference

- Weekly dates with no gaps give a weekly rule with no EXDATEs
- Weekly dates with a missing week give one EXDATE
- Dates two weeks apart give INTERVAL=2
- Dates only in the summer months give BYMONTH
- 2nd and 4th Tuesdays give a monthly BYDAY=2TU,4TU rule
- 4th Tuesdays, including months with five Tuesdays, give BYDAY=4TU
- Same date each year gives a yearly rule
- Irregular dates are flagged and imported as one-time Events
- Exact-match check rejects a rule that expands to one extra date
- Too many EXDATEs are flagged

### Import — Series build

- Cancelled Occurrence becomes an Override, not an EXDATE
- Prefix is removed before the title comparison, so a cancelled Occurrence has no title Override
- Occurrence with a different title or location becomes an Override
- Occurrence at a different time on a rule date becomes a rescheduled Override
- Different description, image, CTA, or Tags flag contentDiffers
- A single Occurrence becomes a one-time Event with its own Schedule status

### Import — real Tockify fixture

- Fixture has 551 Occurrences, 28 Events, and 15 Series
- Every Series is rebuilt by an exact-match rule or flagged, and the report matches the expected table
- Every rebuilt Series, with its Overrides, expands through the engine to exactly its feed Occurrences
- Wednesday Evening Rides on 2026-09-30 is a cancelled Override
- Hair of the Dog Ride is yearly with three tentative Overrides
- Seven Events go to advocacy, and the rest to rides
- No title contains `**`; no Tag is a weekday or Advocacy
- Running the import twice gives the same result (stable order, stable Source IDs)

## Task order (test-first, one small commit per step)

1. **add-rrule-dependency** — `pnpm add rrule`; commit with the feed fixture.
2. **wall-clock-helpers** — tests, then `wall-clock.ts`.
3. **one-time-occurrences** — window tests for one-time and all-day Events, then the simple path of
   `expandOccurrences`.
4. **series-expansion** — Series tests (DST, EXDATE, UNTIL, COUNT, BYMONTH, monthly, yearly,
   all-day), then `expand-rule.ts`.
5. **override-application** — Override tests (content, status, note, rescheduled, moved out of and
   into the window, ignored Overrides, sort), then the Override step.
6. **ics-parser** — parser tests, then `ics.ts`.
7. **tockify-occurrence-mapping** — mapping tests, then `tockify-occurrence.ts`.
8. **calendar-and-tag-cleanup** — tests, then `calendar-and-tags.ts`.
9. **rule-inference** — tests, then `infer-rule.ts` with the exact-match check through the engine.
10. **series-build** — tests, then `build-series.ts` (base values, Overrides, flags, fallback).
11. **import-entry-point-and-fixture-check** — fixture tests, then `import-tockify.ts`.
12. **refactor-and-verify** — clean up; `pnpm test`, `pnpm lint`, `pnpm typecheck` all pass.

## Verification

- `pnpm test` — all cases above pass; the fixture test prints nothing and asserts the Series table.
- `pnpm lint` and `pnpm typecheck` pass.
- No file outside `src/engine/**` (except `types.ts`), `src/import/**`, `docs/plans/**`,
  `package.json`, and `pnpm-lock.yaml` changes.
- No commit is pushed or merged to `main`.
