/**
 * The admin look: the nav marks the current page, the dashboard counts match the pages, no admin
 * page scrolls sideways on a phone, and a header click leaves no focus ring. Logs in as the e2e Admin
 * (session row from global setup), so the Editors page is in the nav.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { E2E_ADMIN, IDS } from "./fixture";

async function logInAsAdmin(context: BrowserContext) {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_ADMIN.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
}

const adminNav = (page: Page) => page.getByRole("navigation", { name: "Admin" });

test.beforeEach(async ({ context }) => logInAsAdmin(context));

test("the nav marks the current page", async ({ page }) => {
  const sections: [string, RegExp][] = [
    ["/admin/events", /^Events$/],
    ["/admin/review", /^Review queue/],
    ["/admin/tags", /^Tags$/],
    ["/admin/editors", /^Editors$/],
  ];
  for (const [path, name] of sections) {
    await page.goto(path);
    const nav = adminNav(page);
    await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
  // A page under a section marks the section.
  await page.goto(`/admin/events/${IDS.tuesday}`);
  await expect(adminNav(page).getByRole("link", { name: /^Events$/ })).toHaveAttribute("aria-current", "page");
  // The dashboard marks no section.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(adminNav(page).locator('[aria-current="page"]')).toHaveCount(0);
});

test("the dashboard counts match the Review queue and the public week", async ({ page }) => {
  await page.goto("/admin/review");
  const queueRows = await page.locator("table tbody tr").count();

  await page.goto("/admin");
  await expect(page.getByTestId("pending-count")).toHaveText(String(queueRows));
  await expect(adminNav(page).getByRole("link", { name: `Review queue (${queueRows})` })).toBeVisible();

  // The fixture week: one Tuesday Ride, one Thursday Ride, and the meeting (today + 3). Deleted and
  // pending Events are not public, so they are not in it.
  const week = page.getByTestId("week-list");
  const count = Number(await page.getByTestId("week-count").textContent());
  expect(count).toBeGreaterThanOrEqual(3);
  if (count <= 8) await expect(week.getByRole("listitem")).toHaveCount(count);
  for (const title of ["E2E Tuesday Ride", "E2E Thursday Ride", "E2E Commission Meeting"]) {
    await expect(week.getByRole("link", { name: title })).toBeVisible();
  }
  for (const title of ["E2E Deleted Ride", "E2E Pending Ride"]) {
    await expect(week.getByRole("link", { name: title })).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { level: 2, name: "Recent changes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Event" })).toHaveAttribute("href", "/admin/events/new");
});

const WIDTHS = [320, 375, 640, 768, 1024];

test("no admin page scrolls sideways at 320, 375, 640, 768, and 1024 px", async ({ page }) => {
  test.setTimeout(180_000); // 12 pages at 5 widths
  await page.goto(`/admin/events/${IDS.tuesday}`);
  const occurrence = await page.getByRole("link", { name: "Change this date" }).first().getAttribute("href");
  const paths = [
    "/admin",
    "/admin/events",
    "/admin/events?deleted=1",
    "/admin/events/new",
    `/admin/events/${IDS.tuesday}`,
    `/admin/events/${IDS.meeting}`,
    `/admin/events/${IDS.pending}`,
    `/admin/events/${IDS.deleted}`,
    occurrence!,
    "/admin/review",
    "/admin/tags",
    "/admin/editors",
  ];
  const scrolls: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // The lists stream in after the shell: measure only when every Suspense fallback is gone.
      // (The router can keep an earlier page hidden in the DOM: count only visible fallbacks.)
      await expect(page.getByText("Loading…").filter({ visible: true })).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) scrolls.push(`${path} at ${width} px: ${overflow} px`);
    }
  }
  expect(scrolls).toEqual([]);
});

test("a stacked row on a phone: the label is read once, not in the cell name", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin/tags");
  // The visible "Slug" label is CSS text with an empty alternative, so the cell name is the slug only.
  await expect(page.getByRole("cell", { name: "non-drop", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^Slug/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /^Non-Drop/ })).toMatchAriaSnapshot(`
    - row:
      - cell "Non-Drop"
      - cell "non-drop"
      - cell "1"
  `);
});

test("after a click in the nav and a key press, focus is on the h1 and no ring shows", async ({ page }) => {
  await page.goto("/admin/events");
  await adminNav(page).getByRole("link", { name: /^Tags$/ }).click();
  const h1 = page.getByRole("heading", { level: 1, name: "Tags" });
  await expect(h1).toBeFocused();
  await page.keyboard.press("Shift");
  const ringInHeader = await page.evaluate(() => document.querySelector("header :focus-visible") !== null);
  expect(ringInHeader).toBe(false);
  expect(await h1.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
});

test("a page that streams its h1 (an Event) also gets the focus on it", async ({ page }) => {
  await page.goto("/admin/events");
  await page.getByRole("link", { name: "E2E Tuesday Ride" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E Tuesday Ride" })).toBeFocused();
});

test("a query change (a Calendar tab) does not move the focus", async ({ page }) => {
  await page.goto("/admin/events");
  const tab = page.getByRole("navigation", { name: "Calendars" }).getByRole("link", { name: "Advocacy" });
  await tab.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/calendar=advocacy/);
  await expect(page.getByRole("heading", { level: 1, name: "Events" })).not.toBeFocused();
  await expect(tab).toBeFocused();
});

// "After" screenshots for the review, only when E2E_SCREENSHOT_DIR is set (outside the repository).
test("screenshots of every admin page at 1280 and 375 px", async ({ page }) => {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  test.skip(!dir, "E2E_SCREENSHOT_DIR is not set");
  await page.goto(`/admin/events/${IDS.tuesday}`);
  const occurrence = await page.getByRole("link", { name: "Change this date" }).first().getAttribute("href");
  const pages: [string, string][] = [
    ["home", "/admin"],
    ["events", "/admin/events"],
    ["events-new", "/admin/events/new"],
    ["event-series", `/admin/events/${IDS.tuesday}`],
    ["event-one-time", `/admin/events/${IDS.meeting}`],
    ["event-pending", `/admin/events/${IDS.pending}`],
    ["event-deleted", `/admin/events/${IDS.deleted}`],
    ["occurrence", occurrence!],
    ["review", "/admin/review"],
    ["tags", "/admin/tags"],
    ["editors", "/admin/editors"],
  ];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
    }
  }
});
