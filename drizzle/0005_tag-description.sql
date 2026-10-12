ALTER TABLE "tags" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_description_length" CHECK (char_length("tags"."description") <= 200);--> statement-breakpoint
-- Starting descriptions for two lesser-known Tags. Only a Tag with no description gets one, so an
-- Editor's text is never overwritten.
UPDATE "tags" AS t
SET "description" = d."description", "updated_at" = now()
FROM (VALUES
  ('non-drop', 'A group ride where everyone sticks together and leaves no one behind.'),
  ('alley-cat', 'Part race, part scavenger hunt. Riders navigate their own route between a list of checkpoints.')
) AS d("slug", "description")
WHERE t."slug" = d."slug" AND t."description" IS NULL;
