# Bike GR Calendar — Context

The community event calendars for the Greater Grand Rapids Bicycle Coalition (Bike GR). They replace
Tockify and are embedded in the Bike GR Squarespace site. One organization, two Calendars.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Calendar** | One of two fixed, separate sets of Events: **Rides & Events** (`rides` — rides, races, social and charity events) and **Advocacy** (`advocacy` — civic meetings, commissions, planning sessions). Each Event belongs to exactly one Calendar. An Event never shows in the other Calendar. Not a tenant: both Calendars share the same Editors and theme. |
| **Event** | One thing that happens: a ride, a meeting, a race. Has a title, description, location, Tags, image, optional CTA, and either one time slot or a recurrence rule. Belongs to one Calendar. |
| **Series** | An Event that repeats. Stored once, with an RFC 5545 `RRULE` and `EXDATE`s. Never stored as one row per date. |
| **Series split** | The result of an Editor changing the time or the rule of a Series "from this date on". The old Series ends the day before; a new Series starts on that date and links to the old one as its predecessor. The only way to change the time or rule of a Series. |
| **Occurrence** | One dated instance of an Event. A one-time Event has exactly one. A Series has many, computed when a query runs, for the requested date window only. |
| **Override** | A stored change to one Occurrence of a Series (new time, new location, Schedule status, Schedule note). Keyed by the Series and the Occurrence's original start. |
| **All-day event** | An Event with a date but no time of day. |
| **Wall-clock time** | The local date and time a rider sees (e.g. 6:00 pm). Stored together with the IANA time zone `America/Detroit`, so DST changes do not move it. |
| **Schedule status** | Whether an Occurrence will happen as listed: `scheduled`, `tentative` (date to be confirmed), `cancelled`, `postponed` (new date not known), or `rescheduled` (moved by an Override; shown on both the old and the new date). Every value except `scheduled` shows a public badge. |
| **Schedule note** | Short public text on one Occurrence, shown next to its badge (e.g. "Rain — see you next week"). Allowed with any Schedule status. |
| **Tag** | A label used to filter Events (Group-Ride, Non-Drop, Race, …). Belongs to one Calendar. Editors manage the list; Submitters only pick from it. |
| **Tag slug** | The stable, URL-safe name of a Tag (`non-drop`). Renaming a Tag keeps its slug, so shared filter links keep working. |
| **Day filter** | A filter by day of week (one or more days). An Occurrence matches on every day it covers, in wall-clock dates (a Friday-to-Sunday event shows for Fri, Sat, and Sun). Not a Tag. |
| **Submission** | An Event that a member of the public sent through the public form. It is an Event with Review status `pending`, not a separate record type. Its Calendar comes from the link the Submitter followed; it may repeat weekly until a date. |
| **Submitter** | The person who sent a Submission. Name and email are kept for contact and never shown publicly. |
| **Review status** | The review life cycle of an Event: `pending` → `approved` or `rejected`. Only `approved` Events are public. |
| **Review queue** | The list of `pending` Events, across both Calendars, that Editors approve, edit, or reject. |
| **Reject** | Refuse a Submission. It never becomes public. |
| **Cancel** | Mark an Occurrence (or a one-time Event) as not happening. It stays public with its badge. |
| **Delete** | Remove a whole Event that should never have existed (duplicate, test, spam). It is hidden everywhere but kept for history; an Admin can restore it. Occurrences are cancelled, never deleted. |
| **Editor** | An invited person who logs in and manages Events and the Review queue in both Calendars. |
| **Admin** | An Editor who can also invite and deactivate Editors and change settings. |
| **Embed** | One Calendar as shown inside a Squarespace page (an iframe placed by a script). |
| **Feed** | A machine-readable export of approved Occurrences — ICS for calendar apps. |
| **Call to action (CTA)** | An optional button on an Event with a label and a URL (e.g. "Register"). Tockify calls it a "promotion button". |
| **Source ID** | The ID of an Event in the system it was imported from (the Tockify event ID). Used to make the import safe to run again. |

## Avoid

- "Instance" — say **Occurrence**.
- "Recurring event" in code — say **Series**.
- "Moderator" or "reviewer" — say **Editor**.
- "Approval table" or "submissions table" — a Submission is an Event with Review status `pending`.
- "Status" alone — say **Review status** or **Schedule status**.
- "Space", "tenant", or "sub-calendar" — say **Calendar**.
- "Advocacy tag" — Advocacy is a **Calendar**, not a Tag.
- Weekday Tags (Monday … Sunday) — use the **Day filter**.
