import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editors, eventManagers, events, overrides } from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

describe("Event manager schema", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  const series = {
    calendar: "rides" as const,
    title: "Wednesday Evening Ride",
    allDay: false,
    startLocal: "2026-11-04T18:00",
    endLocal: "2026-11-04T20:00",
    rrule: "FREQ=WEEKLY",
  };

  async function expectCheck(run: () => Promise<unknown>, name: string) {
    let error: unknown;
    try {
      await run();
    } catch (e) {
      error = e;
    }
    const err = error as { message?: string; cause?: { message?: string } } | undefined;
    expect(`${err?.message} ${err?.cause?.message ?? ""}`).toContain(name);
  }

  it("stores the event_manager role and a grant, and cascades on delete", async () => {
    const [manager] = await db
      .insert(editors)
      .values({ email: "leader@example.com", name: "Leader", role: "event_manager" })
      .returning();
    const [event] = await db.insert(events).values(series).returning();
    await db.insert(eventManagers).values({ eventId: event.id, editorId: manager.id });
    await expectCheck(
      () => db.insert(eventManagers).values({ eventId: event.id, editorId: manager.id }),
      "event_managers_event_id_editor_id_pk",
    );
    await db.delete(editors).where(eq(editors.id, manager.id));
    expect(await db.select().from(eventManagers)).toHaveLength(0);
  });

  it("refuses Occurrence details longer than 2,000 characters", async () => {
    const [event] = await db.insert(events).values({ ...series, occurrenceDetails: "x".repeat(2000) }).returning();
    await expectCheck(
      () => db.insert(events).values({ ...series, occurrenceDetails: "x".repeat(2001) }),
      "events_occurrence_details_length",
    );
    await expectCheck(
      () =>
        db.insert(overrides).values({
          eventId: event.id,
          originalStart: "2026-11-11T18:00",
          occurrenceDetails: "x".repeat(2001),
        }),
      "overrides_occurrence_details_length",
    );
  });
});
