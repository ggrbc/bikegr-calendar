-- Data migration: Tag names get spaces instead of dashes ("Group-Ride" becomes "Group Ride").
-- The same rule as the Tockify import (tagName in src/import/calendar-and-tags.ts): each dash
-- becomes a space, runs of spaces become one, and the ends are trimmed.
--
-- - Slugs do not change, so filter links and Feed URLs keep working.
-- - Idempotent: a second run finds no name with a dash and changes nothing.
-- - Name clash: Tag management refuses two Tags of one Calendar with the same name
--   (case-insensitive). A Tag whose new name another Tag of the same Calendar already has (active or
--   retired) is LEFT AS IT IS; an Editor can rename it by hand in the admin.
-- - Jeremy runs it on production by hand (pnpm db:migrate). Tests run it on PGlite only.
UPDATE "tags" AS t
SET
  "name" = btrim(regexp_replace(replace(t."name", '-', ' '), '\s+', ' ', 'g')),
  "updated_at" = now()
WHERE t."name" LIKE '%-%'
  AND NOT EXISTS (
    SELECT 1
    FROM "tags" AS other
    WHERE other."calendar" = t."calendar"
      AND other."id" <> t."id"
      AND lower(other."name") = lower(btrim(regexp_replace(replace(t."name", '-', ' '), '\s+', ' ', 'g')))
  );
