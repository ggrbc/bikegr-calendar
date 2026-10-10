/**
 * Playwright global setup: migrate the local e2e database and write the known fixture. Local Docker
 * Postgres only (`BIKEGR_PG_PORT=55432 docker compose -p bikegr-e2e-public up -d --wait`). It
 * refuses any Neon URL, so it can never touch a shared or production database.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { EventRuleInput, Timing } from "@/engine";
import { E2E_ADMIN, E2E_DATABASE_URL, E2E_EDITOR, fixtureDates, IDS } from "./fixture";

const timed = (day: string, from = "18:00", to = "20:00"): Timing => ({
  kind: "timed",
  start: `${day}T${from}`,
  end: `${day}T${to}`,
});

function rule(timing: Timing, rrule: string | null = null): ReturnType<typeof ruleInputToColumns> {
  const input: EventRuleInput = {
    eventId: "",
    timing,
    rrule,
    exdates: [],
    scheduleStatus: "scheduled",
    scheduleNote: null,
  };
  return ruleInputToColumns(input);
}

export default async function globalSetup() {
  const host = new URL(E2E_DATABASE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("E2E_DATABASE_URL must point at a local database");
  }
  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  const db = drizzle({ client, schema });
  try {
    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    await db.execute(
      sql`truncate events, tags, event_tags, overrides, event_history, rate_limits, auth_sessions, editors cascade`,
    );
    await db.insert(schema.editors).values([
      { id: E2E_EDITOR.id, email: E2E_EDITOR.email, name: E2E_EDITOR.name, role: "editor", emailVerified: new Date() },
      { id: E2E_ADMIN.id, email: E2E_ADMIN.email, name: E2E_ADMIN.name, role: "admin", emailVerified: new Date() },
    ]);
    const expires = new Date(Date.now() + 24 * 3600 * 1000);
    await db.insert(schema.authSessions).values([
      { sessionToken: E2E_EDITOR.sessionToken, userId: E2E_EDITOR.id, expires },
      { sessionToken: E2E_ADMIN.sessionToken, userId: E2E_ADMIN.id, expires },
    ]);

    const dates = fixtureDates(todayInDetroit(new Date()));
    const description = "A no-drop ride along the river. Lights required after dark. ".repeat(6).trim();
    await db.insert(schema.events).values([
      {
        id: IDS.tuesday,
        calendar: "rides",
        title: "E2E Tuesday Ride",
        description,
        location: "Riverside Park",
        reviewStatus: "approved",
        ctaLabel: "Register",
        ctaUrl: "https://example.org/register",
        ...rule(timed(dates.firstTuesday), "FREQ=WEEKLY;BYDAY=TU"),
      },
      {
        id: IDS.thursday,
        calendar: "rides",
        title: "E2E Thursday Ride",
        description,
        location: "Ada Park",
        reviewStatus: "approved",
        ...rule(timed(dates.firstThursday, "18:30", "20:30"), "FREQ=WEEKLY;BYDAY=TH"),
      },
      {
        id: IDS.meeting,
        calendar: "advocacy",
        title: "E2E Commission Meeting",
        reviewStatus: "approved",
        ...rule(timed(dates.meeting, "09:00", "11:00")),
      },
      {
        id: IDS.deleted,
        calendar: "rides",
        title: "E2E Deleted Ride",
        reviewStatus: "approved",
        deletedAt: new Date(),
        ...rule(timed(dates.deleted)),
      },
      {
        id: IDS.pending,
        calendar: "rides",
        title: "E2E Pending Ride",
        reviewStatus: "pending",
        ...rule(timed(dates.deleted)),
      },
    ]);
    const [nonDrop, meeting] = await db
      .insert(schema.tags)
      .values([
        { calendar: "rides", name: "Non-Drop", slug: "non-drop" },
        { calendar: "advocacy", name: "Meeting", slug: "meeting" },
      ])
      .returning();
    await db.insert(schema.eventTags).values([
      { eventId: IDS.tuesday, tagId: nonDrop.id, calendar: "rides" },
      { eventId: IDS.meeting, tagId: meeting.id, calendar: "advocacy" },
    ]);
  } finally {
    await client.end();
  }
}
