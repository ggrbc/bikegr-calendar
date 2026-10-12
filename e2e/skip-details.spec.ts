/**
 * "Skip the details page" (Tockify's option on the promotion button): an Editor turns it on, then
 * the agenda title links to the button URL and the detail page redirects there. The `.ics` file
 * stays. The test makes its own one-time Event and deletes it at the end, so the other specs keep
 * their counts.
 */
import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import { addDays } from "@/engine";
import { E2E_DATABASE_URL, E2E_EDITOR, segment } from "./fixture";

const EVENT_ID = "10000000-0000-4000-8000-0000000000b1";
const TITLE = "E2E Planning Commission Agenda";
const CTA_URL = "https://example.org/agenda";
const day = addDays(todayInDetroit(new Date()), 4);
const detailPath = `/events/${EVENT_ID}/${segment(day)}`;

test.describe.configure({ mode: "serial" });

async function withSql(run: (sql: postgres.Sql) => Promise<void>) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await run(sql);
  } finally {
    await sql.end();
  }
}

async function removeEvent(sql: postgres.Sql) {
  await sql`delete from event_history where event_id = ${EVENT_ID}`;
  await sql`delete from events where id = ${EVENT_ID}`;
}

test.beforeAll(async () => {
  await withSql(async (sql) => {
    await removeEvent(sql);
    await drizzle({ client: sql, schema }).insert(schema.events).values({
      id: EVENT_ID,
      calendar: "advocacy",
      title: TITLE,
      reviewStatus: "approved",
      reviewedAt: new Date(),
      ...ruleInputToColumns({
        eventId: "",
        timing: { kind: "timed", start: `${day}T18:00`, end: `${day}T20:00` },
        rrule: null,
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      }),
    });
  });
});

test.afterAll(async () => {
  await withSql(removeEvent);
});

test("skip details: the agenda title and the detail page go to the button URL; the .ics stays", async ({
  context,
  page,
  request,
}) => {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_EDITOR.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
  await page.goto(`/admin/events/${EVENT_ID}`);
  await page.getByLabel("Button label").locator("visible=true").fill("Agenda");
  await page.getByLabel("Button URL").locator("visible=true").fill(CTA_URL);
  await page.getByLabel("Skip the details page").locator("visible=true").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Skip the details page").locator("visible=true")).toBeChecked();

  const detail = await request.get(detailPath, { maxRedirects: 0 });
  expect(detail.status()).toBe(307);
  expect(detail.headers().location).toBe(CTA_URL);
  expect((await request.get(`${detailPath}/event.ics`)).status()).toBe(200);

  await page.goto("/advocacy");
  const title = page.getByRole("link", { name: TITLE });
  await expect(title).toHaveAttribute("href", CTA_URL);
  await expect(title).toHaveAttribute("target", "_blank");

  // Turned off again: the detail page is back.
  await page.goto(`/admin/events/${EVENT_ID}`);
  await page.getByLabel("Skip the details page").locator("visible=true").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();
  expect((await request.get(detailPath, { maxRedirects: 0 })).status()).toBe(200);
  await page.goto("/advocacy");
  await expect(page.getByRole("link", { name: TITLE })).toHaveAttribute("href", detailPath);
});
