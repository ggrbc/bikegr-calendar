/**
 * Plain records that the Tockify import returns. No database types: the database layer maps these
 * to rows and upserts by Source ID. Terms follow CONTEXT.md.
 */
import type {
  CalendarSlug,
  EventRuleInput,
  LocalDate,
  OverrideInput,
  StoredScheduleStatus,
  Timing,
} from "@/engine/types";

/** Call to action: Tockify's "promotion button". */
export interface Cta {
  label: string;
  url: string;
}

/** One `VEVENT` of the Tockify feed: one Occurrence, read and cleaned. */
export interface TockifyOccurrence {
  /** The `<eventId>` part of the UID. Shared by all Occurrences of a Series. */
  tockifyEventId: string;
  /** The `<startMinutes>` part of the UID: start in minutes since the Unix epoch. */
  startMinutes: number;
  timing: Timing;
  scheduleStatus: StoredScheduleStatus;
  /** `SUMMARY` with the Schedule status prefix removed. */
  title: string;
  description: string;
  location: string | null;
  /** `CATEGORIES` as Tockify writes them, before Tag cleanup. */
  categories: string[];
  imageUrl: string | null;
  cta: Cta | null;
}

export interface ImportedEvent {
  /** `<eventId>`, or `<eventId>/<startMinutes>` for a one-time Event made from a flagged Series. */
  sourceId: string;
  calendar: CalendarSlug;
  title: string;
  description: string;
  location: string | null;
  tagSlugs: string[];
  /** Tockify CloudFront URL. Copying the image into our blob storage is a later task. */
  imageUrl: string | null;
  cta: Cta | null;
  /** `rule.eventId` is the `sourceId`. */
  rule: EventRuleInput;
}

export interface ImportedTag {
  calendar: CalendarSlug;
  name: string;
  slug: string;
}

export type ImportFlagReason = "ruleNotInferred" | "contentDiffers";

/** Something an Editor must check by hand after the import. */
export interface ImportFlag {
  /** The Tockify `<eventId>`. */
  sourceId: string;
  title: string;
  reason: ImportFlagReason;
  detail: string;
}

/** How the import rebuilt one Series (an Event with more than one Occurrence in the feed). */
export interface SeriesReport {
  sourceId: string;
  title: string;
  occurrences: number;
  outcome: "rule" | "flagged";
  rrule: string | null;
  /** Last date of the rule (`UNTIL`), or `null` if the Series is open-ended (or flagged). */
  until: LocalDate | null;
  exdates: number;
  overrides: number;
}

export interface ImportResult {
  /** Latest Occurrence start date in the whole feed. */
  feedHorizon: LocalDate;
  events: ImportedEvent[];
  /** `eventId` is the Series' `sourceId`. */
  overrides: OverrideInput[];
  tags: ImportedTag[];
  flags: ImportFlag[];
  series: SeriesReport[];
}
