/**
 * Migration 0005: the starting descriptions of Non-Drop and Alley Cat. The test database already
 * ran it (on no data), so the test runs its UPDATE again on data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tags } from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

const update = readFileSync(
  fileURLToPath(new URL("../../drizzle/0005_tag-description.sql", import.meta.url)),
  "utf8",
)
  .split("--> statement-breakpoint")
  .find((statement) => statement.includes("UPDATE"))!;

describe("migration: starting Tag descriptions", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await db.insert(tags).values([
      { calendar: "rides", name: "Non Drop", slug: "non-drop" },
      { calendar: "rides", name: "Alley Cat", slug: "alley-cat", description: "An Editor's text." },
      { calendar: "rides", name: "Race", slug: "race" },
    ]);
    await db.execute(sql.raw(update));
  });
  afterAll(async () => close());

  it("describes Non-Drop, keeps an Editor's description, and leaves other Tags alone", async () => {
    const rows = await db
      .select({ slug: tags.slug, description: tags.description })
      .from(tags)
      .orderBy(asc(tags.slug));
    expect(rows).toEqual([
      { slug: "alley-cat", description: "An Editor's text." },
      { slug: "non-drop", description: "A group ride where everyone sticks together and leaves no one behind." },
      { slug: "race", description: null },
    ]);
  });
});
