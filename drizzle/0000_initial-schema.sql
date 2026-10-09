CREATE TYPE "public"."calendar" AS ENUM('rides', 'advocacy');--> statement-breakpoint
CREATE TYPE "public"."editor_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('scheduled', 'tentative', 'cancelled', 'postponed');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "editors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "editor_role" DEFAULT 'editor' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editors_email_unique" UNIQUE("email"),
	CONSTRAINT "editors_email_lowercase" CHECK ("editors"."email" = lower("editors"."email"))
);
--> statement-breakpoint
CREATE TABLE "event_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_tags" (
	"event_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"calendar" "calendar" NOT NULL,
	CONSTRAINT "event_tags_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar" "calendar" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text,
	"all_day" boolean NOT NULL,
	"start_local" timestamp(0) without time zone,
	"end_local" timestamp(0) without time zone,
	"start_date" date,
	"end_date" date,
	"time_zone" text DEFAULT 'America/Detroit' NOT NULL,
	"rrule" text,
	"exdates" text[] DEFAULT '{}'::text[] NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"schedule_status" "schedule_status" DEFAULT 'scheduled' NOT NULL,
	"schedule_note" text,
	"cta_label" text,
	"cta_url" text,
	"image_url" text,
	"submitter_name" text,
	"submitter_email" text,
	"source_id" text,
	"predecessor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "events_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "events_id_calendar_unique" UNIQUE("id","calendar"),
	CONSTRAINT "events_timing_shape" CHECK (("events"."all_day" and "events"."start_date" is not null and "events"."end_date" is not null
            and "events"."start_local" is null and "events"."end_local" is null and "events"."end_date" >= "events"."start_date")
        or (not "events"."all_day" and "events"."start_local" is not null and "events"."end_local" is not null
            and "events"."start_date" is null and "events"."end_date" is null and "events"."end_local" >= "events"."start_local")),
	CONSTRAINT "events_whole_minutes" CHECK (("events"."start_local" is null or date_trunc('minute', "events"."start_local") = "events"."start_local")
        and ("events"."end_local" is null or date_trunc('minute', "events"."end_local") = "events"."end_local")),
	CONSTRAINT "events_time_zone_detroit" CHECK ("events"."time_zone" = 'America/Detroit'),
	CONSTRAINT "events_rrule_value" CHECK ("events"."rrule" is null or ("events"."rrule" <> '' and "events"."rrule" !~* '^RRULE:')),
	CONSTRAINT "events_exdates_format" CHECK (array_to_string("events"."exdates", ',') ~ (case when "events"."all_day"
            then '^([0-9]{4}-[0-9]{2}-[0-9]{2}(,[0-9]{4}-[0-9]{2}-[0-9]{2})*)?$'
            else '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(,[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})*)?$' end)),
	CONSTRAINT "events_cta_pair" CHECK (("events"."cta_label" is null) = ("events"."cta_url" is null))
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"event_id" uuid NOT NULL,
	"original_start" text NOT NULL,
	"all_day" boolean,
	"start_local" timestamp(0) without time zone,
	"end_local" timestamp(0) without time zone,
	"start_date" date,
	"end_date" date,
	"title" text,
	"location" text,
	"schedule_status" "schedule_status",
	"schedule_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "overrides_event_id_original_start_pk" PRIMARY KEY("event_id","original_start"),
	CONSTRAINT "overrides_original_start_format" CHECK ("overrides"."original_start" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$'),
	CONSTRAINT "overrides_timing_shape" CHECK (("overrides"."all_day" is null and "overrides"."start_local" is null and "overrides"."end_local" is null
            and "overrides"."start_date" is null and "overrides"."end_date" is null)
        or ("overrides"."all_day" and "overrides"."start_date" is not null and "overrides"."end_date" is not null
            and "overrides"."start_local" is null and "overrides"."end_local" is null and "overrides"."end_date" >= "overrides"."start_date")
        or (not "overrides"."all_day" and "overrides"."start_local" is not null and "overrides"."end_local" is not null
            and "overrides"."start_date" is null and "overrides"."end_date" is null and "overrides"."end_local" >= "overrides"."start_local")),
	CONSTRAINT "overrides_whole_minutes" CHECK (("overrides"."start_local" is null or date_trunc('minute', "overrides"."start_local") = "overrides"."start_local")
        and ("overrides"."end_local" is null or date_trunc('minute', "overrides"."end_local") = "overrides"."end_local"))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar" "calendar" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "tags_calendar_slug_unique" UNIQUE("calendar","slug"),
	CONSTRAINT "tags_id_calendar_unique" UNIQUE("id","calendar"),
	CONSTRAINT "tags_slug_format" CHECK ("tags"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_editors_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_editors_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_invited_by_editors_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_deactivated_by_editors_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_changed_by_editors_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_fk" FOREIGN KEY ("event_id","calendar") REFERENCES "public"."events"("id","calendar") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tag_fk" FOREIGN KEY ("tag_id","calendar") REFERENCES "public"."tags"("id","calendar") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_predecessor_id_events_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_editors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_editors_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_reviewed_by_editors_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_deleted_by_editors_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_created_by_editors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_updated_by_editors_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_editors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_history_event_idx" ON "event_history" USING btree ("event_id","changed_at");--> statement-breakpoint
CREATE INDEX "event_tags_tag_idx" ON "event_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "events_review_queue_idx" ON "events" USING btree ("created_at") WHERE "events"."review_status" = 'pending' and "events"."deleted_at" is null;