/**
 * Data migration 0001: Tag names get spaces instead of dashes ("Group-Ride" becomes "Group Ride").
 * The test database already ran it (on no data), so the test runs the same SQL again on data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tags } from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

const migration = readFileSync(
  fileURLToPath(new URL("../../drizzle/0001_tag-names-without-dashes.sql", import.meta.url)),
  "utf8",
);

async function runMigration(db: Db) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const rows = (db: Db) =>
  db
    .select({ calendar: tags.calendar, name: tags.name, slug: tags.slug })
    .from(tags)
    .orderBy(asc(tags.calendar), asc(tags.slug));

describe("migration: Tag names without dashes", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await db.insert(tags).values([
      { calendar: "rides", name: "Group-Ride", slug: "group-ride" },
      { calendar: "rides", name: "Non-Drop", slug: "non-drop" },
      { calendar: "rides", name: "Race", slug: "race" },
      { calendar: "rides", name: "Women - Only", slug: "women-only" },
      // An Editor renamed another Tag to "Social Ride": "Social-Ride" must stay, so names do not clash.
      { calendar: "rides", name: "Social Ride", slug: "social" },
      { calendar: "rides", name: "Social-Ride", slug: "social-ride" },
      // The same name in the other Calendar is no clash.
      { calendar: "advocacy", name: "Group-Ride", slug: "group-ride" },
      // Two Tags whose new names are the same: neither is renamed.
      { calendar: "advocacy", name: "Bike-Lane", slug: "bike-lane" },
      { calendar: "advocacy", name: "Bike - Lane", slug: "lanes" },
      { calendar: "advocacy", name: "bike--lane", slug: "lanes-2" },
    ]);
    await runMigration(db);
  });
  afterAll(async () => close());

  it('"Group-Ride" becomes "Group Ride", and the slugs do not change', async () => {
    expect(await rows(db)).toEqual([
      { calendar: "rides", name: "Group Ride", slug: "group-ride" },
      { calendar: "rides", name: "Non Drop", slug: "non-drop" },
      { calendar: "rides", name: "Race", slug: "race" },
      { calendar: "rides", name: "Social Ride", slug: "social" },
      { calendar: "rides", name: "Social-Ride", slug: "social-ride" },
      { calendar: "rides", name: "Women Only", slug: "women-only" },
      { calendar: "advocacy", name: "Bike-Lane", slug: "bike-lane" },
      { calendar: "advocacy", name: "Group Ride", slug: "group-ride" },
      { calendar: "advocacy", name: "Bike - Lane", slug: "lanes" },
      { calendar: "advocacy", name: "bike--lane", slug: "lanes-2" },
    ]);
  });

  it("uses the same name rule as the import", async () => {
    const { tagName } = await import("@/import/calendar-and-tags");
    for (const name of ["Group-Ride", "Women - Only ", "a--b", " x -  y "]) {
      const [row] = await db.execute<{ n: string }>(
        sql`select btrim(regexp_replace(replace(${name}, '-', ' '), '\\s+', ' ', 'g')) as n`,
      ).then((r) => ("rows" in r ? (r.rows as { n: string }[]) : (r as unknown as { n: string }[])));
      expect(row.n, name).toBe(tagName(name));
    }
  });

  it("a second run changes nothing", async () => {
    const before = await rows(db);
    await runMigration(db);
    expect(await rows(db)).toEqual(before);
  });
});
