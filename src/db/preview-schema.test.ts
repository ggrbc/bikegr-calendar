import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events } from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

describe("Custom Preview column", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  const event = {
    calendar: "rides" as const,
    title: "Ride",
    allDay: false,
    startLocal: "2026-11-04T18:00",
    endLocal: "2026-11-04T20:00",
  };

  it("is null by default and refuses more than 300 characters", async () => {
    const [plain] = await db.insert(events).values(event).returning();
    expect(plain.preview).toBeNull();
    await db.insert(events).values({ ...event, preview: "é".repeat(300) });
    let error: unknown;
    try {
      await db.insert(events).values({ ...event, preview: "x".repeat(301) });
    } catch (e) {
      error = e;
    }
    const err = error as { message?: string; cause?: { message?: string } } | undefined;
    expect(`${err?.message} ${err?.cause?.message ?? ""}`).toContain("events_preview_length");
  });
});
