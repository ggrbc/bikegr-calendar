import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import type { CalendarSlug, StoredScheduleStatus } from "@/engine/types";
import {
  CALENDARS,
  STORED_SCHEDULE_STATUSES,
  editors,
  eventTags,
  events,
  overrides,
  tags,
} from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

/** Runs `run` and expects Postgres to refuse it because of the named constraint. */
async function expectConstraint(run: () => Promise<unknown>, constraint: string) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  expect(error, `expected a "${constraint}" violation`).toBeDefined();
  const err = error as { message?: string; cause?: { message?: string } };
  expect(`${err.message} ${err.cause?.message ?? ""}`).toContain(constraint);
}

const timed = {
  calendar: "rides" as const,
  title: "Tuesday ride",
  allDay: false,
  startLocal: "2026-11-03T18:00",
  endLocal: "2026-11-03T20:00",
};

describe("schema", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  it("enum values match the engine contract", () => {
    expectTypeOf<(typeof CALENDARS)[number]>().toEqualTypeOf<CalendarSlug>();
    expectTypeOf<(typeof STORED_SCHEDULE_STATUSES)[number]>().toEqualTypeOf<StoredScheduleStatus>();
    expect([...CALENDARS]).toEqual(["rides", "advocacy"]);
  });

  it("local time stays wall-clock", async () => {
    // 2026-11-03 is after the DST change (2026-11-01). Write with the session in Detroit, read with
    // the session in UTC: a `timestamptz` column would come back 5 hours later; a wall-clock
    // `timestamp` column comes back unchanged.
    await db.execute(sql`set time zone 'America/Detroit'`);
    const [row] = await db.insert(events).values(timed).returning();
    await db.execute(sql`set time zone 'UTC'`);
    try {
      const [read] = await db.select().from(events).where(eq(events.id, row.id));
      expect(read.startLocal).toBe("2026-11-03T18:00");
      expect(read.endLocal).toBe("2026-11-03T20:00");
      expect(read.timeZone).toBe("America/Detroit");
    } finally {
      await db.execute(sql`reset time zone`);
    }

    // PGlite returns `{ rows }`; the result type is driver-generic, so read it as that shape.
    const columns = (await db.execute(sql`
      select column_name, data_type from information_schema.columns
      where table_name in ('events', 'overrides') and column_name in ('start_local', 'end_local')`)) as unknown as {
      rows: { data_type: string }[];
    };
    expect(columns.rows).toHaveLength(4);
    for (const column of columns.rows) {
      expect(column.data_type).toBe("timestamp without time zone");
    }
  });

  it("timing shape must be complete", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, startDate: "2026-11-03", endDate: "2026-11-03" }),
      "events_timing_shape",
    );
    await expectConstraint(
      () => db.insert(events).values({ calendar: "rides", title: "No time", allDay: false }),
      "events_timing_shape",
    );
    await expectConstraint(
      () => db.insert(events).values({ calendar: "rides", title: "No dates", allDay: true }),
      "events_timing_shape",
    );
    const [allDay] = await db
      .insert(events)
      .values({ calendar: "rides", title: "Bike swap", allDay: true, startDate: "2026-06-06", endDate: "2026-06-07" })
      .returning();
    expect(allDay.endDate).toBe("2026-06-07");
  });

  it("zone must be America/Detroit", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, timeZone: "America/Chicago" }),
      "events_time_zone_detroit",
    );
  });

  it("rrule is stored without the RRULE: prefix", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, rrule: "RRULE:FREQ=WEEKLY" }),
      "events_rrule_value",
    );
  });

  it("OriginalStart format is enforced", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, exdates: ["2026-11-10"] }),
      "events_exdates_format",
    );
    const [series] = await db
      .insert(events)
      .values({ ...timed, rrule: "FREQ=WEEKLY;BYDAY=TU", exdates: ["2026-11-10T18:00", "2026-11-17T18:00"] })
      .returning();
    await expectConstraint(
      () => db.insert(overrides).values({ eventId: series.id, originalStart: "2026-11-10 18:00" }),
      "overrides_original_start_format",
    );
  });

  it("override key is unique", async () => {
    const [series] = await db
      .insert(events)
      .values({ ...timed, rrule: "FREQ=WEEKLY;BYDAY=TU" })
      .returning();
    await db
      .insert(overrides)
      .values({ eventId: series.id, originalStart: "2026-11-10T18:00", scheduleStatus: "cancelled" });
    await expectConstraint(
      () => db.insert(overrides).values({ eventId: series.id, originalStart: "2026-11-10T18:00" }),
      "overrides_event_id_original_start_pk",
    );
  });

  it("override timing must be one complete shape", async () => {
    const [series] = await db
      .insert(events)
      .values({ ...timed, rrule: "FREQ=WEEKLY;BYDAY=TU" })
      .returning();
    await expectConstraint(
      () =>
        db
          .insert(overrides)
          .values({ eventId: series.id, originalStart: "2026-11-17T18:00", allDay: false, startLocal: "2026-11-19T18:00" }),
      "overrides_timing_shape",
    );
    const [moved] = await db
      .insert(overrides)
      .values({
        eventId: series.id,
        originalStart: "2026-11-17T18:00",
        allDay: false,
        startLocal: "2026-11-19T18:00",
        endLocal: "2026-11-19T20:00",
      })
      .returning();
    expect(moved.startLocal).toBe("2026-11-19T18:00");
  });

  it("CTA needs both label and URL", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, ctaLabel: "Register" }),
      "events_cta_pair",
    );
  });

  it("skip details needs a CTA", async () => {
    await expectConstraint(
      () => db.insert(events).values({ ...timed, ctaSkipDetails: true }),
      "events_cta_skip_details_needs_cta",
    );
  });

  it("tag slug is unique per Calendar", async () => {
    await db.insert(tags).values({ calendar: "rides", name: "Non-Drop", slug: "non-drop" });
    await db.insert(tags).values({ calendar: "advocacy", name: "Non-Drop", slug: "non-drop" });
    await expectConstraint(
      () => db.insert(tags).values({ calendar: "rides", name: "Non drop", slug: "non-drop" }),
      "tags_calendar_slug_unique",
    );
    await expectConstraint(
      () => db.insert(tags).values({ calendar: "rides", name: "Bad", slug: "Bad Slug" }),
      "tags_slug_format",
    );
  });

  it("tag keeps who changed and who retired it", async () => {
    const [editor] = await db.insert(editors).values({ email: "tagger@example.org" }).returning();
    const [tag] = await db
      .insert(tags)
      .values({ calendar: "rides", name: "Gravel", slug: "gravel", createdBy: editor.id })
      .returning();
    expect(tag.updatedAt).toBeInstanceOf(Date);
    const [retired] = await db
      .update(tags)
      .set({ retiredAt: new Date(), retiredBy: editor.id, updatedBy: editor.id })
      .where(eq(tags.id, tag.id))
      .returning();
    expect(retired.retiredBy).toBe(editor.id);
    expect(retired.updatedBy).toBe(editor.id);
  });

  it("tag from the other Calendar is refused", async () => {
    const [ride] = await db.insert(events).values(timed).returning();
    const [advocacyTag] = await db
      .insert(tags)
      .values({ calendar: "advocacy", name: "Commission", slug: "commission" })
      .returning();
    await expectConstraint(
      () => db.insert(eventTags).values({ eventId: ride.id, tagId: advocacyTag.id, calendar: "rides" }),
      "event_tags_tag_fk",
    );
    await expectConstraint(
      () => db.insert(eventTags).values({ eventId: ride.id, tagId: advocacyTag.id, calendar: "advocacy" }),
      "event_tags_event_fk",
    );
  });

  it("calendar move needs cleared Tags", async () => {
    const [ride] = await db.insert(events).values(timed).returning();
    const [rideTag] = await db
      .insert(tags)
      .values({ calendar: "rides", name: "Group-Ride", slug: "group-ride" })
      .returning();
    await db.insert(eventTags).values({ eventId: ride.id, tagId: rideTag.id, calendar: "rides" });

    await expectConstraint(
      () => db.update(events).set({ calendar: "advocacy" }).where(eq(events.id, ride.id)),
      "event_tags_tag_fk",
    );

    await db.delete(eventTags).where(eq(eventTags.eventId, ride.id));
    const [moved] = await db
      .update(events)
      .set({ calendar: "advocacy" })
      .where(eq(events.id, ride.id))
      .returning();
    expect(moved.calendar).toBe("advocacy");
  });

  it("editor email must be lowercase", async () => {
    await expectConstraint(
      () => db.insert(editors).values({ email: "Someone@BikeGR.org" }),
      "editors_email_lowercase",
    );
  });
});
