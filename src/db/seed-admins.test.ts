import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editors } from "./schema";
import { FIRST_ADMINS, seedAdmins } from "./seed-admins";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

describe("seedAdmins", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createTestDb()));
  afterAll(async () => close());

  it("seed is safe to run again", async () => {
    expect(await seedAdmins(db)).toBe(3);
    expect(await seedAdmins(db)).toBe(0);

    const rows = await db.select().from(editors);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.email).sort()).toEqual(
      ["bultentom@bikegr.org", "jeremy@bikegr.org", "nate@bikegr.org"],
    );
    expect(rows.every((r) => r.role === "admin" && r.deactivatedAt === null)).toBe(true);
    expect(FIRST_ADMINS).toHaveLength(3);
  });
});
