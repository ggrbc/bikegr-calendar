# Bike GR Calendar — Context

The community event calendar for the Greater Grand Rapids Bicycle Coalition (Bike GR). It replaces
Tockify and is embedded in the Bike GR Squarespace site.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Event** | One thing that happens: a ride, a meeting, a race. Has a title, description, location, tags, image, and either one time slot or a recurrence rule. |
| **Series** | An Event that repeats. Stored once, with an RFC 5545 `RRULE` and `EXDATE`s. Never stored as one row per date. |
| **Occurrence** | One dated instance of an Event. A one-time Event has exactly one. A Series has many, computed when a query runs, for the requested date window only. |
| **Override** | A stored change to one Occurrence of a Series (new time, new location, cancelled). Keyed by the Series and the Occurrence's original start. |
| **All-day event** | An Event with a date but no time of day. |
| **Wall-clock time** | The local date and time a rider sees (e.g. 6:00 pm). Stored together with the IANA time zone `America/Detroit`, so DST changes do not move it. |
| **Tag** | A label used to filter Events (Group-Ride, Non-Drop, Advocacy, Race, …). |
| **Submission** | An Event that a member of the public sent through the public form. It is an Event with status `pending`, not a separate record type. |
| **Submitter** | The person who sent a Submission. Name and email are kept for contact and never shown publicly. |
| **Status** | The life cycle of an Event: `pending` → `approved` or `rejected`. Only `approved` Events are public. |
| **Review queue** | The list of `pending` Events that Editors approve, edit, or reject. |
| **Editor** | An invited person who logs in and manages Events and the Review queue. |
| **Admin** | An Editor who can also invite and deactivate Editors and change settings. |
| **Embed** | The calendar as shown inside the Squarespace page (an iframe placed by a script). |
| **Feed** | A machine-readable export of approved Occurrences — ICS for calendar apps. |
| **Call to action (CTA)** | An optional button on an Event with a label and a URL (e.g. "Register"). Tockify calls it a "promotion button". |
| **Source ID** | The ID of an Event in the system it was imported from (the Tockify event ID). Used to make the import safe to run again. |

## Avoid

- "Instance" — say **Occurrence**.
- "Recurring event" in code — say **Series**.
- "Moderator" or "reviewer" — say **Editor**.
- "Approval table" or "submissions table" — a Submission is an Event with status `pending`.
