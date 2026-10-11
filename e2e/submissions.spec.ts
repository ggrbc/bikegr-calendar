/**
 * Submissions and the Review queue, end to end. Turnstile runs offline: a stub widget script gives
 * a token, and the host server stands in for siteverify (TURNSTILE_SITEVERIFY_URL). The Editor logs
 * in with the session row from global setup. Each test sends from its own IP (`x-forwarded-for`,
 * which the app reads off Vercel), so the per-IP limit of 3 an hour does not mix the tests.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { todayInDetroit } from "@/agenda/dates";
import { addDays } from "@/engine";
import { E2E_EDITOR, nextWeekday } from "./fixture";
import { stubTurnstile } from "./turnstile";

const today = todayInDetroit(new Date());
const tuesday = nextWeekday(addDays(today, 1), 2);
const until = addDays(tuesday, 56);

async function logIn(context: BrowserContext) {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_EDITOR.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
}

async function fillRide(page: Page, title: string) {
  await page.getByLabel("Title (required)").fill(title);
  await page.getByLabel("Description").fill("A social ride. Lights after dark.");
  await page.getByLabel("Location").fill("Riverside Park");
  await page.getByLabel("Starts (required)").fill(`${tuesday}T18:00`);
  await page.getByLabel("Repeats", { exact: true }).check();
  await page.getByRole("checkbox", { name: "Tue", exact: true }).check();
  await page.getByLabel("Until (the date of the last one)").fill(until);
  await page.getByLabel("Your name (required)").fill("Sam Rider");
  await page.getByLabel("Your email (required)").fill("sam@example.org");
}

async function send(page: Page) {
  const button = page.getByRole("button", { name: "Send the event" });
  await expect(button).toBeEnabled();
  await button.click();
}

test("a Submission is not public until an Editor edits and approves it", async ({ page, context, request }) => {
  await stubTurnstile(page, "198.51.100.1");
  await page.goto("/submit?calendar=rides");
  await expect(page.getByRole("heading", { level: 1, name: "Submit an Event" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Rides & Events" })).toBeChecked();
  await expect(page.getByText("Series")).toHaveCount(0);
  await fillRide(page, "E2E Submitted Ride");
  await send(page);

  await expect(page).toHaveURL(/\/submit\/thanks\?calendar=rides$/);
  await expect(page.getByRole("heading", { level: 1, name: "Thank you" })).toBeVisible();

  // Not public: agenda, Embed, Feed.
  await page.goto("/rides");
  await expect(page.getByText("E2E Submitted Ride")).toHaveCount(0);
  await page.goto("/embed/rides");
  await expect(page.getByText("E2E Submitted Ride")).toHaveCount(0);
  expect(await (await request.get("/feeds/rides.ics")).text()).not.toContain("E2E Submitted Ride");

  // The Review queue lists it, with its Calendar and Submitter.
  await logIn(context);
  await page.goto("/admin/review");
  const row = page.getByRole("row", { name: /E2E Submitted Ride/ });
  await expect(row).toContainText("Rides & Events");
  await expect(row).toContainText("Sam Rider");
  await expect(row).toContainText("Every week on Tuesday");
  await expect(page.getByRole("link", { name: /Review queue \(\d+\)/ })).toBeVisible();

  await row.getByRole("link", { name: "E2E Submitted Ride" }).click();
  await expect(page.getByRole("heading", { name: "Review this Submission" })).toBeVisible();
  await expect(page.getByText("Submitted by Sam Rider")).toBeVisible();
  await expect(page.getByRole("link", { name: "sam@example.org" })).toHaveAttribute("href", "mailto:sam@example.org");
  const eventId = new URL(page.url()).pathname.split("/").at(-1)!;

  // Its detail URL is a 404 while pending.
  expect((await request.get(`/events/${eventId}/${tuesday}T1800`)).status()).toBe(404);

  // An unsaved change blocks Approve; Save, then Approve.
  await page.getByLabel("Calendar", { exact: true }).selectOption("advocacy");
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. The Event is public. The Submitter gets an email.")).toBeVisible();

  // Public now, on the Calendar the Editor picked.
  await page.goto("/advocacy");
  await expect(page.getByRole("link", { name: "E2E Submitted Ride" }).first()).toBeVisible();
  expect((await request.get(`/events/${eventId}/${tuesday}T1800`)).status()).toBe(200);
  await page.goto("/admin/review");
  await expect(page.getByRole("row", { name: /E2E Submitted Ride/ })).toHaveCount(0);
});

test("a filled honeypot shows the thank-you page and adds nothing to the queue", async ({ page, context }) => {
  await stubTurnstile(page, "198.51.100.2");
  await page.goto("/submit");
  await fillRide(page, "E2E Honeypot Ride");
  const honeypot = page.locator('input[name="bgr_hp_field"]');
  // Hidden from screen readers (not in the accessibility tree) and out of the tab order.
  await expect(page.getByRole("textbox", { name: "Leave this empty" })).toHaveCount(0);
  await expect(honeypot).toHaveAttribute("tabindex", "-1");
  await expect(honeypot).toHaveAttribute("autocomplete", "off");
  await honeypot.fill("https://spam.example");
  await send(page);
  await expect(page.getByRole("heading", { level: 1, name: "Thank you" })).toBeVisible();

  await logIn(context);
  await page.goto("/admin/review");
  await expect(page.getByText("E2E Honeypot Ride")).toHaveCount(0);
});

test("a field error keeps the input; a refused spam check saves nothing", async ({ page, context }) => {
  await stubTurnstile(page, "198.51.100.3", "e2e-refused");
  await page.goto("/submit?calendar=advocacy");
  await expect(page.getByRole("radio", { name: "Advocacy" })).toBeChecked();
  await fillRide(page, "E2E Refused Ride");
  // A Tuesday start with only Monday picked is refused, and the input stays.
  await page.getByRole("checkbox", { name: "Tue", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Mon", exact: true }).check();
  await send(page);
  await expect(page.getByText("The first date must be on one of the days you picked.")).toBeVisible();
  await expect(page.getByLabel("Title (required)")).toHaveValue("E2E Refused Ride");
  await expect(page.getByRole("checkbox", { name: "Mon", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Tue", exact: true }).check();

  await page.getByLabel("Your name (required)").fill("");
  await send(page);
  await expect(page.getByText("Give your name.")).toBeVisible();
  await expect(page.getByLabel("Title (required)")).toHaveValue("E2E Refused Ride");

  await page.getByLabel("Your name (required)").fill("Sam Rider");
  await send(page);
  await expect(page.getByText("The spam check did not pass.", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/submit\?calendar=advocacy$/);

  await logIn(context);
  await page.goto("/admin/review");
  await expect(page.getByText("E2E Refused Ride")).toHaveCount(0);
});

test("a spam-check pass for another hostname saves nothing", async ({ page, context }) => {
  await stubTurnstile(page, "198.51.100.5", "e2e-other-host");
  await page.goto("/submit");
  await fillRide(page, "E2E Other Host Ride");
  await send(page);
  await expect(page.getByText("The spam check did not pass.", { exact: false })).toBeVisible();
  await logIn(context);
  await page.goto("/admin/review");
  await expect(page.getByText("E2E Other Host Ride")).toHaveCount(0);
});

test("the agenda pages link to the form with their Calendar; the Embed has no link", async ({ page }) => {
  await page.goto("/rides");
  await expect(page.getByRole("link", { name: "Submit an Event" })).toHaveAttribute("href", "/submit?calendar=rides");
  await page.goto("/advocacy");
  await expect(page.getByRole("link", { name: "Submit an Event" })).toHaveAttribute("href", "/submit?calendar=advocacy");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Submit an Event" })).toHaveAttribute("href", "/submit");
  await page.goto("/embed/rides");
  await expect(page.getByRole("link", { name: "Submit an Event" })).toHaveCount(0);
});

test("the form cannot be framed", async ({ request }) => {
  const response = await request.get("/submit");
  expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});

// Screenshots for the review, only when E2E_SCREENSHOT_DIR is set (outside the repository).
test("screenshots of /submit and /admin/review at 1280 and 375 px", async ({ page, context }) => {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  test.skip(!dir, "E2E_SCREENSHOT_DIR is not set");
  await stubTurnstile(page, "198.51.100.4");
  // One Submission in each Calendar, so the queue has rows.
  for (const calendar of ["rides", "advocacy"]) {
    await page.goto(`/submit?calendar=${calendar}`);
    await fillRide(page, calendar === "rides" ? "Thursday Gravel Group Ride" : "Vital Streets Oversight Commission");
    await send(page);
    await expect(page.getByRole("heading", { level: 1, name: "Thank you" })).toBeVisible();
  }
  await logIn(context);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/submit?calendar=rides");
    await page.getByLabel("Repeats", { exact: true }).check();
    await page.screenshot({ path: `${dir}/submit-${width}.png`, fullPage: true });
    await page.goto("/admin/review");
    // The queue streams in after the shell; wait for it and the nav.
    await expect(page.getByRole("link", { name: "Thursday Gravel Group Ride" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Review queue \(\d+\)/ })).toBeVisible();
    await page.screenshot({ path: `${dir}/admin-review-${width}.png`, fullPage: true });
  }
});
