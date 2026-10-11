ALTER TABLE "events" ADD COLUMN "preview" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_preview_length" CHECK (char_length("events"."preview") <= 300);