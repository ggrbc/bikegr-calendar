/**
 * Event managers: an Editor adds a manager to a Series; the manager signs in, cancels a date with a
 * note and details; the public detail page and the Feed show it; the manager cannot open an Editor
 * page; a Series split keeps the grant. Sessions are database rows (no magic link). The test makes
 * its own Series and deletes it at the end, so the other specs keep their counts. Screenshots go to
 * the gitignored `.scratch/event-managers/` folder.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import { addDays } from "@/engine";
import { E2E_DATABASE_URL, E2E_EDITOR, nextWeekday, segment } from "./fixture";

const SERIES_ID = "10000000-0000-4000-8000-0000000000a1";
const TITLE = "E2E Wednesday Evening Ride";
const MANAGER = { email: "e2e.wendy.manager@example.org", name: "Wendy Wednesday", sessionToken: "e2e-manager-session-token-not-a-secret" };

const cookie = (context: BrowserContext, sessionToken: string) =>
  context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true }]);

const SHOTS = ".scratch/event-managers";
const SIZES = [
  { name: "1280", width: 1280, height: 900 },
  { name: "375", width: 375, height: 800 },
];

async function shoot(page: Page, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.screenshot({ path: `${SHOTS}/${name}-${size.name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const today = todayInDetroit(new Date());
const firstWednesday = nextWeekday(today, 3);
// The date the manager changes: the second Wednesday, so the first stays untouched.
const changed = addDays(firstWednesday, 7);
const splitDay = addDays(firstWednesday, 21);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from event_history where event_id = ${SERIES_ID}`;
    await sql`delete from events where id = ${SERIES_ID}`;
    await sql`delete from editors where email = ${MANAGER.email}`;
    // Through Drizzle, like global setup: the wall-clock column type does the conversion.
    await drizzle({ client: sql, schema }).insert(schema.events).values({
      id: SERIES_ID,
      calendar: "rides",
      title: TITLE,
      description: "A weekly evening ride.",
      location: "Millennium Park",
      reviewStatus: "approved",
      reviewedAt: new Date(),
      ...ruleInputToColumns({
        eventId: "",
        timing: { kind: "timed", start: `${firstWednesday}T18:00`, end: `${firstWednesday}T20:00` },
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      }),
    });
  } finally {
    await sql.end();
  }
});

test("an Editor adds a manager, who changes one date; the public pages show it", async ({ browser, page, context, request }) => {
  // --- The Editor adds the manager.
  await cookie(context, E2E_EDITOR.sessionToken);
  await page.goto(`/admin/events/${SERIES_ID}`);
  const managers = page.getByRole("region", { name: "Managers" });
  await expect(managers).toContainText("No managers yet.");
  await managers.getByRole("textbox", { name: "Email" }).fill(MANAGER.email);
  await managers.getByRole("textbox", { name: "Name" }).fill(MANAGER.name);
  await managers.getByRole("button", { name: "Add manager" }).click();
  await expect(managers.getByRole("status")).toContainText(`${MANAGER.name} is added`);
  await expect(managers.getByRole("list", { name: "Managers" })).toContainText(MANAGER.email);
  await expect(managers.getByText("Invited")).toBeVisible();
  await shoot(page, "managers-section");
  // The history names the Editor.
  await expect(page.getByText(`Added ${MANAGER.name} as a manager`)).toBeVisible();

  // --- The manager signs in (a session row; the invite email is a magic link we do not open).
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`
      insert into auth_sessions (session_token, user_id, expires)
      select ${MANAGER.sessionToken}, id, now() + interval '1 day' from editors where email = ${MANAGER.email}
      on conflict (session_token) do nothing`;
  } finally {
    await sql.end();
  }
  const managerContext = await browser.newContext();
  await cookie(managerContext, MANAGER.sessionToken);
  const manager = await managerContext.newPage();

  // /admin sends the manager to My Events. The nav has only My Events and Account.
  await manager.goto("/admin");
  await expect(manager).toHaveURL(/\/admin\/my-events$/);
  await expect(manager.getByRole("heading", { level: 1, name: "My Events" })).toBeVisible();
  const nav = manager.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link")).toHaveText(["My Events", "Account"]);
  await expect(manager.getByRole("button", { name: "Sign out" })).toBeVisible();
  const card = manager.getByRole("region", { name: TITLE });
  await expect(card.getByRole("link", { name: /^Edit/ })).toHaveCount(8);
  await card.getByRole("link", { name: /^Show more dates/ }).click();
  await expect(card.getByRole("link", { name: /^Edit/ })).not.toHaveCount(8);
  await manager.goto("/admin/my-events");
  await expect(card.getByRole("link", { name: /^Edit/ })).toHaveCount(8);
  await shoot(manager, "my-events");

  // --- The manager cancels the second Wednesday with a note and details.
  await card.getByRole("link", { name: new RegExp(`^Edit ${TITLE}, `) }).nth(1).click();
  await expect(manager).toHaveURL(new RegExp(`/admin/my-events/${SERIES_ID}/${changed}T1800$`));
  await expect(manager.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  // Only the three fields: no title, time, location, or Tags input.
  await expect(manager.getByRole("combobox")).toHaveCount(1);
  await expect(manager.getByRole("textbox")).toHaveCount(2);
  await manager.getByLabel("Schedule status").selectOption("cancelled");
  await manager.getByLabel("Schedule note").fill("Thunderstorms. See you next week.");
  await manager.getByLabel("Occurrence details").fill("Route was the river loop: https://example.org/route.\n\nStreet tires are fine.");
  await shoot(manager, "date-form");
  await manager.getByRole("button", { name: "Save" }).click();
  await expect(manager.getByRole("status")).toContainText("The change is public now");
  // The form keeps what was saved (React 19 resets a `<form action>`; this form must not).
  await expect(manager.getByLabel("Schedule status")).toHaveValue("cancelled");
  await expect(manager.getByLabel("Schedule note")).toHaveValue("Thunderstorms. See you next week.");
  await shoot(manager, "date-form-saved");

  // --- Un-cancel: set Scheduled, Save, and the public page has no badge. Then cancel again.
  const detail = await browser.newPage();
  await manager.getByLabel("Schedule status").selectOption("scheduled");
  // A change hides the last result, so the next "Saved" is a new element and the wait below is real.
  await expect(manager.getByRole("status")).toHaveCount(0);
  await manager.getByRole("button", { name: "Save" }).click();
  await expect(manager.getByRole("status")).toContainText("The change is public now");
  await expect(manager.getByLabel("Schedule status")).toHaveValue("scheduled");
  await expect(async () => {
    await detail.goto(`/events/${SERIES_ID}/${segment(changed)}`);
    await expect(detail.getByText("Cancelled", { exact: true })).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(detail.getByText("Thunderstorms. See you next week.")).toBeVisible(); // the note stays
  await manager.getByLabel("Schedule status").selectOption("cancelled");
  await manager.getByRole("button", { name: "Save" }).click();
  await expect(manager.getByRole("status")).toContainText("The change is public now");

  // --- The public detail page and the Feed.
  await expect(async () => {
    await detail.goto(`/events/${SERIES_ID}/${segment(changed)}`);
    await expect(detail.getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(detail.getByText("Thunderstorms. See you next week.")).toBeVisible();
  const box = detail.getByRole("region", { name: /^For / });
  await expect(box).toContainText("Street tires are fine.");
  await expect(box.getByRole("link", { name: "https://example.org/route" })).toHaveAttribute("href", "https://example.org/route");
  await shoot(detail, "detail-page");
  // The first Wednesday has no box.
  await detail.goto(`/events/${SERIES_ID}/${segment(firstWednesday)}`);
  await expect(detail.getByRole("region", { name: /^For / })).toHaveCount(0);

  const feed = await request.get("/feeds/rides.ics");
  const ics = (await feed.text()).replace(/\r\n[ \t]/g, "");
  expect(ics).toContain("Street tires are fine.");
  expect(ics).toContain(`SUMMARY:[Cancelled] ${TITLE}`);

  // The agenda card shows the note but not the details.
  const agenda = await browser.newPage();
  await agenda.goto("/rides");
  await expect(agenda.getByText("Street tires are fine.")).toHaveCount(0);

  // --- The manager cannot open an Editor page or an Editor action.
  for (const path of ["/admin/events", "/admin/tags", "/admin/review", "/admin/events/new", `/admin/events/${SERIES_ID}`, "/admin/editors"]) {
    await manager.goto(path);
    await expect(manager, path).toHaveURL(/\/admin\/my-events$/);
  }
  // A date of an Event the manager does not manage is not found.
  await manager.goto(`/admin/my-events/10000000-0000-4000-8000-000000000001/${segment(changed)}`);
  await expect(manager.getByText("This page could not be found.")).toBeVisible();
  // The account page works.
  await manager.goto("/admin/account");
  await expect(manager.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
  await expect(manager.getByText("Event manager", { exact: true })).toHaveCount(2); // header badge and the Role row

  // The Editor sees the manager's change in the history and on the dashboard.
  await page.goto(`/admin/events/${SERIES_ID}`);
  await expect(page.getByText(`Changed one date`).first()).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByText(MANAGER.name).first()).toBeVisible();
  await managerContext.close();
});

test("a Series split keeps the manager's grant, and My Events lists both parts", async ({ browser, page, context }) => {
  await cookie(context, E2E_EDITOR.sessionToken);
  await page.goto(`/admin/events/${SERIES_ID}`);
  await page.getByRole("radio", { name: /This date and later/ }).check();
  await page.getByLabel("From this date").first().fill(splitDay);
  await page.getByLabel("Starts").fill("19:00");
  await page.getByLabel("Ends").fill("21:00");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
  await expect(page).not.toHaveURL(new RegExp(SERIES_ID));
  // The new Event has the grant (and the history says so).
  await expect(page.getByRole("list", { name: "Managers" })).toContainText(MANAGER.email);
  await expect(page.getByText(`Managers copied by a Series split: ${MANAGER.name}`)).toBeVisible();

  const managerContext = await browser.newContext();
  await cookie(managerContext, MANAGER.sessionToken);
  const manager = await managerContext.newPage();
  await manager.goto("/admin/my-events");
  // Two cards with the same title: the old part and the new part.
  await expect(manager.getByRole("region", { name: TITLE })).toHaveCount(2);
  await managerContext.close();

  // Clean up through the Editor's Delete (it also clears the public cache).
  for (const id of await allSeriesIds()) {
    await page.goto(`/admin/events/${id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^Delete/ }).click();
    await expect(page.getByText("This Event was deleted")).toBeVisible();
  }
});

async function allSeriesIds(): Promise<string[]> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ id: string }[]>`select id from events where title = ${TITLE} and deleted_at is null`;
    return rows.map((r) => r.id);
  } finally {
    await sql.end();
  }
}
