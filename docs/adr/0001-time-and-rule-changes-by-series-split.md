# Time and rule changes to a Series only through a Series split

An Editor can change the time or the `RRULE` of a Series only with "this and following", which makes
a Series split: the old Event ends the day before a chosen date, and a new Event (linked as its
successor) starts on that date. "All Occurrences" edits content fields only (title, description,
Tags, image, CTA, location). We decided this because an in-place time or rule change rewrites past
Occurrences, and it orphans Overrides, which are keyed by the Occurrence's original start.

## Considered options

- **Edit the rule in place ("All" changes everything), like Google Calendar.** Rejected: past
  Occurrences show the new time, and every Override whose `original_start` no longer matches the rule
  must be found and fixed or dropped.
- **Only "this Occurrence" and "all".** Rejected: the common real change ("from May the ride starts
  at 6:30") has no correct way to express it.

## Consequences

- A split makes a new Event, so one ride can be several Event rows over the years. The predecessor
  link joins them for history.
- Feed UIDs (`<eventId>-<originalStart>`) of Occurrences after the split change once; subscribers
  see those Occurrences as removed and added.
- Overrides on or after the split date move to the new Event.
