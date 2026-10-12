/**
 * Database schema. Terms follow CONTEXT.md. Column-type reasons are in
 * docs/plans/app-skeleton-and-admin-auth.md ("Time storage").
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { localDateTime } from "./columns";

// ---------------------------------------------------------------------------------------------
// Enums. The value lists are fixed by the glossary; schema.test.ts checks that they match the
// engine contract.

export const CALENDARS = ["rides", "advocacy"] as const;
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
/** Stored Schedule status values. `rescheduled` is derived by the engine and never stored. */
export const STORED_SCHEDULE_STATUSES = ["scheduled", "tentative", "cancelled", "postponed"] as const;
export const EDITOR_ROLES = ["admin", "editor", "event_manager"] as const;
/** The roles an Admin can invite or choose in a form. An `event_manager` comes only from a grant. */
export const INVITE_ROLES = ["admin", "editor"] as const;

export const calendarEnum = pgEnum("calendar", CALENDARS);
export const reviewStatusEnum = pgEnum("review_status", REVIEW_STATUSES);
export const scheduleStatusEnum = pgEnum("schedule_status", STORED_SCHEDULE_STATUSES);
export const editorRoleEnum = pgEnum("editor_role", EDITOR_ROLES);

export type EditorRole = (typeof EDITOR_ROLES)[number];

/** The only time zone the engine supports (`TIME_ZONE` in src/engine/types.ts). */
const DETROIT = "America/Detroit";

// Postgres regexes for the engine's string formats. `[0-9]` instead of `\d`, so no escape issues.
const RE_DATE = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
const RE_DATE_TIME = `${RE_DATE}T[0-9]{2}:[0-9]{2}`;

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => instant("created_at").notNull().defaultNow();
const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------------------------
// Editors. Also the Auth.js user table: `id`, `name`, `email`, `emailVerified`, `image` are the
// columns the Drizzle adapter needs.

export const editors = pgTable(
  "editors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: editorRoleEnum("role").notNull().default("editor"),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => editors.id),
    invitedAt: instant("invited_at"),
    deactivatedAt: instant("deactivated_at"),
    deactivatedBy: uuid("deactivated_by").references((): AnyPgColumn => editors.id),
    /** Set by Auth.js on the first login, so it also means "the invite was accepted". */
    emailVerified: instant("email_verified"),
    image: text("image"),
    createdAt: createdAt(),
  },
  (t) => [check("editors_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export type Editor = typeof editors.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Events

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendar: calendarEnum("calendar").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Custom Preview: plain text for the agenda card and page metadata instead of the description start. */
    preview: text("preview"),
    location: text("location"),

    // Timing: one of two shapes, chosen by `all_day` (CHECK below).
    allDay: boolean("all_day").notNull(),
    startLocal: localDateTime("start_local"),
    endLocal: localDateTime("end_local"),
    startDate: date("start_date", { mode: "string" }),
    /** Inclusive, as in the engine's `Timing`. */
    endDate: date("end_date", { mode: "string" }),
    timeZone: text("time_zone").notNull().default(DETROIT),

    /** RFC 5545 `RRULE` value without the `RRULE:` prefix. Null for a one-time Event. */
    rrule: text("rrule"),
    /** Engine `OriginalStart` strings that the Series skips. */
    exdates: text("exdates").array().notNull().default(sql`'{}'::text[]`),

    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending"),
    /** Schedule status of a one-time Event. A Series uses Overrides instead. */
    scheduleStatus: scheduleStatusEnum("schedule_status").notNull().default("scheduled"),
    scheduleNote: text("schedule_note"),
    /** Longer public text on a one-time Event's only Occurrence. A Series uses Overrides instead. */
    occurrenceDetails: text("occurrence_details"),

    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    /** The agenda title and the detail URL go straight to the CTA URL (Tockify's "skip details page"). */
    ctaSkipDetails: boolean("cta_skip_details").notNull().default(false),
    imageUrl: text("image_url"),

    submitterName: text("submitter_name"),
    submitterEmail: text("submitter_email"),
    sourceId: text("source_id").unique(),
    predecessorId: uuid("predecessor_id").references((): AnyPgColumn => events.id),

    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => editors.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => editors.id),
    reviewedAt: instant("reviewed_at"),
    reviewedBy: uuid("reviewed_by").references(() => editors.id),
    deletedAt: instant("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => editors.id),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("events_id_calendar_unique").on(t.id, t.calendar),
    check(
      "events_timing_shape",
      sql`(${t.allDay} and ${t.startDate} is not null and ${t.endDate} is not null
            and ${t.startLocal} is null and ${t.endLocal} is null and ${t.endDate} >= ${t.startDate})
        or (not ${t.allDay} and ${t.startLocal} is not null and ${t.endLocal} is not null
            and ${t.startDate} is null and ${t.endDate} is null and ${t.endLocal} >= ${t.startLocal})`,
    ),
    check(
      "events_whole_minutes",
      sql`(${t.startLocal} is null or date_trunc('minute', ${t.startLocal}) = ${t.startLocal})
        and (${t.endLocal} is null or date_trunc('minute', ${t.endLocal}) = ${t.endLocal})`,
    ),
    check("events_time_zone_detroit", sql`${t.timeZone} = ${sql.raw(`'${DETROIT}'`)}`),
    check(
      "events_rrule_value",
      sql`${t.rrule} is null or (${t.rrule} <> '' and ${t.rrule} !~* '^RRULE:')`,
    ),
    check(
      "events_exdates_format",
      sql`array_to_string(${t.exdates}, ',') ~ (case when ${t.allDay}
            then ${sql.raw(`'^(${RE_DATE}(,${RE_DATE})*)?$'`)}
            else ${sql.raw(`'^(${RE_DATE_TIME}(,${RE_DATE_TIME})*)?$'`)} end)`,
    ),
    check("events_occurrence_details_length", sql`char_length(${t.occurrenceDetails}) <= 2000`),
    check("events_preview_length", sql`char_length(${t.preview}) <= 300`),
    check("events_cta_pair", sql`(${t.ctaLabel} is null) = (${t.ctaUrl} is null)`),
    check("events_cta_skip_details_needs_cta", sql`not ${t.ctaSkipDetails} or ${t.ctaUrl} is not null`),
    index("events_review_queue_idx")
      .on(t.createdAt)
      .where(sql`${t.reviewStatus} = 'pending' and ${t.deletedAt} is null`),
  ],
);

export type EventRow = typeof events.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Overrides: a stored change to one Occurrence of a Series. Null columns mean "no change".

export const overrides = pgTable(
  "overrides",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The engine's `OriginalStart` string of the Occurrence. */
    originalStart: text("original_start").notNull(),

    allDay: boolean("all_day"),
    startLocal: localDateTime("start_local"),
    endLocal: localDateTime("end_local"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),

    title: text("title"),
    location: text("location"),
    scheduleStatus: scheduleStatusEnum("schedule_status"),
    scheduleNote: text("schedule_note"),
    occurrenceDetails: text("occurrence_details"),

    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => editors.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => editors.id),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.originalStart] }),
    check("overrides_occurrence_details_length", sql`char_length(${t.occurrenceDetails}) <= 2000`),
    check(
      "overrides_original_start_format",
      sql`${t.originalStart} ~ ${sql.raw(`'^${RE_DATE}(T[0-9]{2}:[0-9]{2})?$'`)}`,
    ),
    check(
      "overrides_timing_shape",
      sql`(${t.allDay} is null and ${t.startLocal} is null and ${t.endLocal} is null
            and ${t.startDate} is null and ${t.endDate} is null)
        or (${t.allDay} and ${t.startDate} is not null and ${t.endDate} is not null
            and ${t.startLocal} is null and ${t.endLocal} is null and ${t.endDate} >= ${t.startDate})
        or (not ${t.allDay} and ${t.startLocal} is not null and ${t.endLocal} is not null
            and ${t.startDate} is null and ${t.endDate} is null and ${t.endLocal} >= ${t.startLocal})`,
    ),
    check(
      "overrides_whole_minutes",
      sql`(${t.startLocal} is null or date_trunc('minute', ${t.startLocal}) = ${t.startLocal})
        and (${t.endLocal} is null or date_trunc('minute', ${t.endLocal}) = ${t.endLocal})`,
    ),
  ],
);

export type OverrideRow = typeof overrides.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Event managers: a grant links an account (role `event_manager`) to an Event. The database cannot
// check the role (a CHECK cannot read another table); src/admin/events/managers.ts does.

export const eventManagers = pgTable(
  "event_managers",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => editors.id),
    grantedAt: instant("granted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.editorId] }), index("event_managers_editor_idx").on(t.editorId)],
);

// ---------------------------------------------------------------------------------------------
// Tags

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendar: calendarEnum("calendar").notNull(),
    name: text("name").notNull(),
    /** Stable, URL-safe. Renaming a Tag keeps it. */
    slug: text("slug").notNull(),
    retiredAt: instant("retired_at"),
    retiredBy: uuid("retired_by").references(() => editors.id),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => editors.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => editors.id),
  },
  (t) => [
    unique("tags_calendar_slug_unique").on(t.calendar, t.slug),
    unique("tags_id_calendar_unique").on(t.id, t.calendar),
    check("tags_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/**
 * Event-Tag join. The composite foreign keys make the database refuse a Tag from the other
 * Calendar, and refuse to move an Event to the other Calendar while it still has Tags.
 */
export const eventTags = pgTable(
  "event_tags",
  {
    eventId: uuid("event_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    calendar: calendarEnum("calendar").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.tagId] }),
    foreignKey({
      name: "event_tags_event_fk",
      columns: [t.eventId, t.calendar],
      foreignColumns: [events.id, events.calendar],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    foreignKey({
      name: "event_tags_tag_fk",
      columns: [t.tagId, t.calendar],
      foreignColumns: [tags.id, tags.calendar],
    }).onDelete("cascade"),
    index("event_tags_tag_idx").on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Event history: one JSON snapshot per change. Writes come in the Admin milestone.

export const eventHistory = pgTable(
  "event_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changedBy: uuid("changed_by").references(() => editors.id),
    changedAt: instant("changed_at").notNull().defaultNow(),
  },
  (t) => [index("event_history_event_idx").on(t.eventId, t.changedAt)],
);

// ---------------------------------------------------------------------------------------------
// Auth.js tables (column names follow @auth/drizzle-adapter).

export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    expires: instant("expires").notNull(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: instant("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------------------------
// Rate limits (src/rate-limit). One row per bucket and key: a fixed window and its hit count. The
// key is an HMAC, never a raw IP or email. See docs/plans/magic-link-rate-limit.md.

export const rateLimits = pgTable(
  "rate_limits",
  {
    /** Which limit, in plain text (`magic-link:ip`). Holds no personal data. */
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: instant("window_start").notNull(),
    hits: integer("hits").notNull(),
    /** The window end. Rows past it are pruned. */
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.keyHash] }),
    index("rate_limits_expires_idx").on(t.expiresAt),
    check("rate_limits_hits_positive", sql`${t.hits} >= 1`),
  ],
);
