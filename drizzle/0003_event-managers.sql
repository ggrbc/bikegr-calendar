ALTER TYPE "public"."editor_role" ADD VALUE 'event_manager';--> statement-breakpoint
CREATE TABLE "event_managers" (
	"event_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_managers_event_id_editor_id_pk" PRIMARY KEY("event_id","editor_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "occurrence_details" text;--> statement-breakpoint
ALTER TABLE "overrides" ADD COLUMN "occurrence_details" text;--> statement-breakpoint
ALTER TABLE "event_managers" ADD CONSTRAINT "event_managers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_managers" ADD CONSTRAINT "event_managers_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_managers" ADD CONSTRAINT "event_managers_granted_by_editors_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."editors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_managers_editor_idx" ON "event_managers" USING btree ("editor_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_occurrence_details_length" CHECK (char_length("events"."occurrence_details") <= 2000);--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_occurrence_details_length" CHECK (char_length("overrides"."occurrence_details") <= 2000);