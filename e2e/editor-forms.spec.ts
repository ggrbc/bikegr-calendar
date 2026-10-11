/**
 * The Editor forms keep what they saved. React 19 resets a `<form action>` after the action, which
 * set a controlled select back to its first option. These forms now submit through `onSubmit`
 * (src/app/admin/events/_components/submit-form.ts). One long test runs Create Event, a one-time
 * Event edit, "Save for all dates" on a Series, and "Save this date" on an Override. No image upload
 * (it needs Blob). The test makes its own Events and deletes them at the end.
 */
import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import { addDays } from "@/engine";
import { E2E_DATABASE_URL, E2E_EDITOR, nextWeekday, segment } from "./fixture";

const SERIES_ID = "10000000-0000-4000-8000-0000000000b1";
const SERIES_TITLE = "E2E Forms Series";
const CREATED_TITLE = "E2E Forms Created Event";

const firstThursday = nextWeekday(todayInDetroit(new Date()), 4);
const secondThursday = addDays(firstThursday, 7);

test.beforeAll(async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from event_history where event_id = ${SERIES_ID}`;
    await sql`delete from events where id = ${SERIES_ID}`;
    await drizzle({ client: sql, schema }).insert(schema.events).values({
      id: SERIES_ID,
      calendar: "rides",
      title: SERIES_TITLE,
      description: "A weekly ride.",
      reviewStatus: "approved",
      reviewedAt: new Date(),
      ...ruleInputToColumns({
        eventId: "",
        timing: { kind: "timed", start: `${firstThursday}T18:00`, end: `${firstThursday}T20:00` },
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      }),
    });
  } finally {
    await sql.end();
  }
});

test("Create Event, one-time edit, Save for all dates, and Save this date keep what was saved", async ({ context, page }) => {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_EDITOR.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
  // Visible only: the router can keep an earlier page hidden in the DOM.
  const status = page.getByLabel("Schedule status").locator("visible=true");
  const note = page.getByLabel("Schedule note").locator("visible=true");
  const titleField = page.getByLabel("Title", { exact: true }).locator("visible=true");
  const saved = page.getByRole("status").filter({ hasText: /^Saved/ });

  // --- Create Event (a one-time Event), then edit it: the select keeps its value after Save.
  await page.goto("/admin/events/new");
  await titleField.fill(CREATED_TITLE);
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created/);
  await expect(page.getByRole("heading", { level: 1, name: CREATED_TITLE })).toBeVisible();
  const createdUrl = page.url().split("?")[0];

  await status.selectOption("tentative");
  await note.fill("Waiting on the permit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saved).toBeVisible();
  await expect(status).toHaveValue("tentative");
  await expect(note).toHaveValue("Waiting on the permit");
  // A second save: the status is hidden while it runs, so it announces again.
  await status.selectOption("scheduled");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saved).toBeVisible();
  await expect(status).toHaveValue("scheduled");

  // --- Save for all dates (a Series): the new title stays in the field.
  await page.goto(`/admin/events/${SERIES_ID}`);
  await titleField.fill(`${SERIES_TITLE} (renamed)`);
  await page.getByRole("button", { name: "Save for all dates" }).click();
  await expect(saved).toBeVisible();
  await expect(titleField).toHaveValue(`${SERIES_TITLE} (renamed)`);

  // --- Save this date (an Override): the select keeps its value, and the note stays.
  await page.goto(`/admin/events/${SERIES_ID}/occurrence?start=${encodeURIComponent(`${secondThursday}T18:00`)}`);
  await status.selectOption("cancelled");
  await note.fill("Ice on the trail");
  await page.getByRole("button", { name: "Save this date" }).click();
  await expect(saved).toBeVisible();
  await expect(status).toHaveValue("cancelled");
  await expect(note).toHaveValue("Ice on the trail");
  // The public page shows it.
  await expect(async () => {
    await page.goto(`/events/${SERIES_ID}/${segment(secondThursday)}`);
    await expect(page.getByText("Ice on the trail")).toBeVisible({ timeout: 1000 });
  }).toPass();

  // --- Clean up through the Editor's Delete (it also clears the public cache).
  for (const url of [createdUrl, `/admin/events/${SERIES_ID}`]) {
    await page.goto(url);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^Delete/ }).click();
    await expect(page.getByText("This Event was deleted")).toBeVisible();
  }
});
