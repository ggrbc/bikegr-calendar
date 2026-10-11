/**
 * The rich-text description and the Custom Preview, end to end: the Event editor toolbar, the detail
 * page and agenda card, old plain-text descriptions, paste, the Link box, and a Submission.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import { addDays } from "@/engine";
import { E2E_DATABASE_URL, E2E_EDITOR, nextWeekday, segment } from "./fixture";
import { stubTurnstile } from "./turnstile";

const OLD_ID = "10000000-0000-4000-8000-0000000000c1";
const OLD_DESCRIPTION = "Line one\nLine two\n\nSee https://example.org/x.\n\n* Helmet\n* Water";
const today = todayInDetroit(new Date());
const thursday = nextWeekday(addDays(today, 1), 4);

async function withDb<T>(run: (db: PostgresJsDatabase<typeof schema>) => Promise<T>): Promise<T> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return await run(drizzle({ client: sql, schema }));
  } finally {
    await sql.end();
  }
}

const storedDescription = (id: string) =>
  withDb(async (db) => (await db.select().from(schema.events).where(eq(schema.events.id, id)))[0].description);

async function logIn(context: BrowserContext) {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_EDITOR.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
}

// Visible only: the router can keep an earlier page hidden in the DOM.
const editorBox = (page: Page) => page.getByRole("textbox", { name: "Description" }).locator("visible=true");
const tool = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Text formatting" })
    .locator("visible=true")
    .getByRole("button", { name, exact: true });

test.beforeAll(async () => {
  await withDb(async (db) => {
    await db.delete(schema.eventHistory).where(eq(schema.eventHistory.eventId, OLD_ID));
    await db.delete(schema.events).where(eq(schema.events.id, OLD_ID));
    await db.insert(schema.events).values({
      id: OLD_ID,
      calendar: "rides",
      title: "E2E Old Plain Ride",
      description: OLD_DESCRIPTION,
      reviewStatus: "approved",
      reviewedAt: new Date(),
      ...ruleInputToColumns({
        eventId: "",
        timing: { kind: "timed", start: `${thursday}T18:00`, end: `${thursday}T20:00` },
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      }),
    });
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await db.delete(schema.eventHistory).where(eq(schema.eventHistory.eventId, OLD_ID));
    await db.delete(schema.events).where(eq(schema.events.id, OLD_ID));
  });
});

test("toolbar formatting and a Custom Preview show on the detail page, card, and metadata", async ({
  page,
  context,
}) => {
  await logIn(context);
  await page.goto("/admin/events/new");
  await page.getByLabel("Title", { exact: true }).locator("visible=true").fill("E2E Rich Ride");
  await editorBox(page).click();
  await tool(page, "Heading 1").click();
  await page.keyboard.type("Route");
  await page.keyboard.press("Enter");
  await tool(page, "Bold").click();
  await page.keyboard.type("Lights required");
  await tool(page, "Bold").click();
  await page.keyboard.press("Enter");
  await tool(page, "Bulleted list").click();
  await page.keyboard.type("Helmet");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Water");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Map: ");
  await tool(page, "Link").click();
  await page.getByLabel("Link address").fill("https://example.org/map");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "+ Custom Preview" }).click();
  await page.getByLabel("Custom Preview").fill("Social pace, lights required.");
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created/);
  const adminUrl = page.url().split("?")[0];
  const id = adminUrl.split("/").at(-1)!;

  // The editor reloads the saved Markdown with its formatting.
  await expect(editorBox(page).locator("strong")).toHaveText("Lights required");

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(today)}`);
    await expect(page.getByRole("heading", { level: 2, name: "Route" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.locator("main strong", { hasText: "Lights required" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Helmet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.org/map" })).toHaveAttribute(
    "rel",
    "nofollow noopener noreferrer",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Social pace, lights required.");
  await expect(page.getByText("Social pace, lights required.")).toHaveCount(0);

  await page.goto("/rides");
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "E2E Rich Ride" }) })
    .first();
  await expect(card).toContainText("Social pace, lights required.");
  await expect(card).not.toContainText("**");

  await page.goto(adminUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});

test("an untouched description is saved byte for byte, and line breaks survive an edit", async ({ page, context }) => {
  await logIn(context);
  await page.goto(`/admin/events/${OLD_ID}`);
  // Clicking into a description that ends in a list is not an edit.
  await editorBox(page).click();
  const title = page.getByLabel("Title", { exact: true }).locator("visible=true");
  await title.fill("E2E Old Plain Ride (renamed)");
  await page.getByRole("button", { name: "Save for all dates" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();
  expect(await storedDescription(OLD_ID)).toBe(OLD_DESCRIPTION);

  await editorBox(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Bring lights.");
  await page.getByRole("button", { name: "Save for all dates" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();

  await expect(async () => {
    await page.goto(`/events/${OLD_ID}/${segment(thursday)}`);
    await expect(page.getByText("Bring lights.")).toBeVisible({ timeout: 1000 });
  }).toPass();
  const first = page.locator("main p").filter({ hasText: "Line one" });
  await expect(first.locator("br")).toHaveCount(1);
  await expect(first).toContainText("Line two");
  await expect(page.getByRole("link", { name: "https://example.org/x" })).toBeVisible();
});

test("literal characters, paste, and the Link box stay safe", async ({ page, context }) => {
  await logIn(context);
  await page.goto("/admin/events/new");
  await page.getByLabel("Title", { exact: true }).locator("visible=true").fill("E2E Literal Ride");
  await editorBox(page).click();
  // `5*3 and 2*4` is italic in Markdown unless the editor escapes it; it does not trigger the
  // editor's own `*text*` input rule (that needs a space before the first `*`).
  await page.keyboard.type("Price 5*3 and 2*4, #1 pick");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bikes & Beers <3");
  await page.keyboard.press("Enter");
  await editorBox(page).evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<p><span style="color:red">Red</span> <img src="https://example.org/a.png"> <script>alert(1)</script></p><table><tr><td>Cell</td></tr></table>',
    );
    data.setData("text/plain", "Red Cell");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await tool(page, "Link").click();
  await page.getByLabel("Link address").fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Use a web address that starts with http://, https://, or mailto:." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created/);
  const adminUrl = page.url().split("?")[0];
  const id = adminUrl.split("/").at(-1)!;

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(today)}`);
    await expect(page.getByText("Price 5*3 and 2*4, #1 pick")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText("Bikes & Beers <3")).toBeVisible();
  await expect(page.locator("main em")).toHaveCount(0);
  await expect(page.locator('main img, main table, main script:not([type="application/ld+json"])')).toHaveCount(0);
  await expect(page.locator("main").getByText("Red").first()).toBeVisible();
  await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);

  await page.goto(adminUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});

test("a Submission keeps its formatting and Custom Preview after approval; the toolbar works by keyboard", async ({
  page,
  context,
}) => {
  await stubTurnstile(page, "198.51.100.61");
  await page.goto("/submit?calendar=rides");
  await page.getByLabel("Title (required)").fill("E2E Rich Submission");
  const bold = tool(page, "Bold");
  await editorBox(page).click();
  await bold.focus();
  await page.keyboard.press("Enter");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("Bring lights");
  await page.getByRole("button", { name: "+ Custom Preview" }).click();
  await page.getByLabel("Custom Preview").fill("Evening social ride.");
  await page.getByLabel("Starts (required)").fill(`${thursday}T18:00`);
  await page.getByLabel("Your name (required)").fill("Sam Rider");
  await page.getByLabel("Your email (required)").fill("sam@example.org");
  const send = page.getByRole("button", { name: "Send the event" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page).toHaveURL(/\/submit\/thanks/);

  await logIn(context);
  await page.goto("/admin/review");
  await page
    .getByRole("row", { name: /E2E Rich Submission/ })
    .getByRole("link", { name: "E2E Rich Submission" })
    .click();
  await expect(page.getByRole("heading", { name: "Review this Submission" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  // Loading the editor is not an unsaved change.
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. The Event is public.")).toBeVisible();

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(thursday)}`);
    await expect(page.locator("main strong", { hasText: "Bring lights" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.goto("/rides");
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "E2E Rich Submission" }) })
      .first(),
  ).toContainText("Evening social ride.");

  await page.goto(`/admin/events/${id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});
