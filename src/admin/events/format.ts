/** Text for the admin: Detroit times, the conflict message, history labels. Pure. */
import { clockTime, dayHeading, shortDate } from "@/agenda/dates";
import { type CalendarSlug, type LocalDate, type ScheduleStatus, utcToWallClock } from "@/engine";

export const CALENDAR_LABELS: Record<CalendarSlug, string> = {
  rides: "Rides & Events",
  advocacy: "Advocacy",
};

const STATUS_LABELS: Record<ScheduleStatus, string | null> = {
  scheduled: null,
  tentative: "Date to be confirmed",
  cancelled: "Cancelled",
  postponed: "Postponed",
  rescheduled: "Rescheduled",
};

/** The badge text of a Schedule status; `scheduled` has none. */
export function statusLabel(status: ScheduleStatus): string | null {
  return STATUS_LABELS[status];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "October 27, 2028". */
export function longDate(date: LocalDate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/** An instant as Detroit wall-clock time: "3:12 pm on Saturday, October 10, 2026". */
export function formatInstantDetroit(instant: Date): string {
  const wallClock = utcToWallClock(instant);
  const date = wallClock.slice(0, 10);
  return `${clockTime(wallClock)} on ${dayHeading(date)}, ${date.slice(0, 4)}`;
}

export function conflictMessage(changedAt: Date): string {
  return `Another Editor changed this Event at ${formatInstantDetroit(changedAt)} (Detroit time). Reload to see their change.`;
}

export const DELETED_MESSAGE = "This Event was deleted.";
export const NOT_FOUND_MESSAGE = "This Event does not exist.";

/** Facts in `event_history.snapshot.detail`. */
export interface HistoryDetail {
  originalStart?: string;
  splitDate?: string;
  successorId?: string;
  predecessorId?: string;
  removedOverrides?: string[];
  /** Reject: the Editor's reason, as sent to the Submitter. */
  reason?: string;
  /** Reject or Delete as spam: the image was cleared (no other Event used it) and its blob removed. */
  imageRemoved?: boolean;
}

/** History actions written by the admin and the import. */
export type HistoryAction =
  | "create"
  | "edit"
  | "change-time-or-repeat"
  | "split"
  | "create-from-split"
  | "stop-series"
  | "override"
  | "clear-override"
  | "delete"
  | "restore"
  | "import"
  | "submit"
  | "approve"
  | "reject";

export function historyActionLabel(action: string, detail: HistoryDetail): string {
  const day = (value?: string) => (value ? shortDate(value.slice(0, 10)) : "");
  switch (action) {
    case "create":
      return "Created";
    case "edit":
      return "Edited";
    case "change-time-or-repeat":
      return "Changed the time or the repeat";
    case "split":
      return `Series split: dates from ${day(detail.splitDate)} moved to a new Event`;
    case "create-from-split":
      return `Created by a Series split, from ${day(detail.splitDate)}`;
    case "stop-series":
      return `Series stopped: no dates from ${day(detail.splitDate)}`;
    case "override":
      return `Changed one date (${day(detail.originalStart)})`;
    case "clear-override":
      return `Removed the change to one date (${day(detail.originalStart)})`;
    case "delete":
      return "Deleted";
    case "restore":
      return "Restored";
    case "import":
      return "Import";
    case "submit":
      return "Submitted";
    case "approve":
      return "Approved";
    case "reject":
      return detail.reason ? `Rejected: ${detail.reason}` : "Rejected";
    default:
      return action;
  }
}
