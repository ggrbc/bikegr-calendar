-- Data migration: Tag names get spaces instead of dashes ("Group-Ride" becomes "Group Ride").
-- The same rule as the Tockify import (tagName in src/import/calendar-and-tags.ts): each dash
-- becomes a space, runs of whitespace become one space, and the ends are trimmed.
--
-- - Slugs do not change, so filter links and Feed URLs keep working.
-- - Idempotent: a second run finds no name with a dash and changes nothing.
-- - Name clash: Tag management refuses two Tags of one Calendar with the same name
--   (case-insensitive). Every new name is computed first (CTE). A Tag is renamed only if no other
--   Tag of its Calendar gets the same new name in this run, and no other Tag of its Calendar
--   (active or retired) already has it. Tags that would clash are LEFT AS THEY ARE; an Editor can
--   rename them by hand in the admin.
-- - Jeremy runs it on production by hand (pnpm db:migrate). Tests run it on PGlite only.
WITH "renamed" AS (
  SELECT
    t."id",
    t."calendar",
    btrim(regexp_replace(replace(t."name", '-', ' '), '\s+', ' ', 'g')) AS "new_name"
  FROM "tags" AS t
  WHERE t."name" LIKE '%-%'
),
"counted" AS (
  SELECT r.*, count(*) OVER (PARTITION BY r."calendar", lower(r."new_name")) AS "same_new_name"
  FROM "renamed" AS r
),
"safe" AS (
  SELECT c."id", c."new_name"
  FROM "counted" AS c
  WHERE c."same_new_name" = 1
    AND c."new_name" <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM "tags" AS other
      WHERE other."calendar" = c."calendar"
        AND other."id" <> c."id"
        AND lower(other."name") = lower(c."new_name")
    )
)
UPDATE "tags" AS t
SET "name" = s."new_name", "updated_at" = now()
FROM "safe" AS s
WHERE t."id" = s."id";
