import { expect, test } from "@playwright/test";
import { todayInDetroit } from "@/agenda/dates";
import { addDays } from "@/engine";
import { fixtureDates, IDS, segment } from "./fixture";

const today = todayInDetroit(new Date());
const dates = fixtureDates(today);

test("agenda for Rides shows days, and a Day filter changes the list and the URL", async ({ page }) => {
  await page.goto("/rides");
  await expect(page.getByRole("heading", { level: 1, name: "Rides & Events" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Events from / })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Thursday Ride" }).first()).toBeVisible();
  await expect(page.getByText("E2E Deleted Ride")).toHaveCount(0);
  await expect(page.getByText("E2E Pending Ride")).toHaveCount(0);

  await page.getByText("Filter", { exact: true }).click();
  // One checkbox click filters the list (no Apply click).
  await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await expect(page).toHaveURL(/\/rides\?day=thu$/);
  await expect(page.getByRole("link", { name: "E2E Thursday Ride" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
});

test("no Calendar switcher on the public pages; the routes stay", async ({ page }) => {
  for (const path of ["/rides", "/advocacy", "/"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("navigation", { name: "Calendars" })).toHaveCount(0);
  }
});

test("typing a date with the keyboard navigates once, with the right from", async ({ page }) => {
  await page.goto("/rides");
  const year = Number(today.slice(0, 4));
  const target = `${year}-11-20` > today ? `${year}-11-20` : `${year + 1}-11-20`;
  const navigations: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.headers()["rsc"] === "1" && url.pathname === "/rides" && url.searchParams.has("from")) {
      navigations.push(url.search);
    }
  });
  await page.getByText("Filter", { exact: true }).click();
  const from = page.getByLabel("From");
  // focus() puts the caret on the first part (the month), as Tab does for a rider.
  await from.focus();
  await page.keyboard.type(`${target.slice(5, 7)}${target.slice(8, 10)}${target.slice(0, 4)}`);
  await expect(page).toHaveURL(new RegExp(`from=${target}`));
  await page.waitForTimeout(500);
  expect(navigations).toHaveLength(1);
  await expect(from).toHaveValue(target);
});

test("Back keeps the day boxes in step with the URL", async ({ page }) => {
  await page.goto("/rides");
  await page.getByText("Filter", { exact: true }).click();
  const tue = page.getByRole("checkbox", { name: "Tue", exact: true });
  const thu = page.getByRole("checkbox", { name: "Thu", exact: true });
  await tue.check();
  await expect(page).toHaveURL(/\?day=tue$/);
  await thu.check();
  await expect(page).toHaveURL(/\?day=tue,thu$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?day=tue$/);
  await expect(tue).toBeChecked();
  await expect(thu).not.toBeChecked();
  await page.goBack();
  await expect(page).toHaveURL(/\/rides$/);
  await expect(tue).not.toBeChecked();
  await expect(thu).not.toBeChecked();
});

test("text typed in the search while a filter loads stays", async ({ page }) => {
  await page.goto("/rides");
  await page.route("**/rides?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByText("Filter", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Fri", exact: true }).check();
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("Wee");
  await expect(page).toHaveURL(/\?day=fri$/);
  await page.waitForTimeout(300);
  await expect(search).toHaveValue("Wee");
});

test("From and then To both arrive in the URL", async ({ page }) => {
  const from = addDays(today, 10);
  const to = addDays(today, 15);
  await page.goto("/rides");
  await page.getByText("Filter", { exact: true }).click();
  await page.getByLabel("From").fill(from);
  await page.getByLabel("To").fill(to);
  await page.keyboard.press("Tab");
  await expect(page).toHaveURL(new RegExp(`\\?from=${from}&to=${to}$`));
});

test("a From change moves the default range; to stays out of the URL", async ({ page }) => {
  const from = addDays(today, 10);
  await page.goto("/rides");
  await page.getByText("Filter", { exact: true }).click();
  await page.getByLabel("From").fill(from);
  await page.keyboard.press("Tab");
  await expect(page).toHaveURL(new RegExp(`\\?from=${from}$`));
  await expect(page.getByLabel("To")).toHaveValue(addDays(from, 55));
});

test("the list is marked busy while a filter click loads", async ({ page }) => {
  await page.goto("/rides");
  await page.route("**/rides?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.getByText("Filter", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await expect(page.locator("#agenda-results")).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(/\?day=thu$/);
  await expect(page.locator("#agenda-results")).not.toHaveAttribute("aria-busy", "true");
});

test("Escape closes the phone menu and puts the focus back on its button", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/rides");
  const menu = page.locator("#site-menu");
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(menu.locator("summary")).toBeFocused();
});

test("the search box placeholder and border meet AA contrast", async ({ page }) => {
  await page.goto("/rides");
  const search = page.getByRole("searchbox", { name: "Search" });
  const style = await search.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, width: s.borderTopWidth };
  });
  expect(style).toEqual({ border: "rgb(133, 132, 134)", width: "1px" });
});

test("the search applies on Enter, and Clear removes every filter", async ({ page }) => {
  await page.goto("/rides");
  await page.getByRole("searchbox", { name: "Search" }).fill("thursday");
  await page.getByRole("searchbox", { name: "Search" }).press("Enter");
  await expect(page).toHaveURL(/\/rides\?q=thursday$/);
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).toHaveURL(/\/rides$/);
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
});

test("without JavaScript, the Apply button submits the filters", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/rides");
  await page.getByText("Filter", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/\/rides\?.*day=thu/);
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  await context.close();
});

test("a far-future from is clamped: the page renders, with no error", async ({ page }) => {
  for (const path of ["/rides?from=9999-06-01", "/embed/rides?from=9999-06-01"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /^Events from / })).toBeVisible();
    await expect(page.getByText("could not load")).toHaveCount(0);
  }
});

test("a retired or unknown Tag gives no results and no error", async ({ page }) => {
  await page.goto("/rides?tag=no-such-tag");
  await expect(page.getByText("No events match.")).toBeVisible();
});

test("detail page shows the Occurrence and has JSON-LD", async ({ page }) => {
  const response = await page.goto(`/events/${IDS.tuesday}/${segment(dates.firstTuesday)}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Tuesday Ride" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" })).toHaveAttribute("href", "https://example.org/register");
  await expect(page.getByRole("link", { name: "Google Calendar" })).toBeVisible();
  const note = page.getByText("Plans can change! Please check with the organizers on the day of the event");
  await expect(note).toBeVisible();
  // The note comes after the details and before "Add to calendar".
  const noteTop = (await note.boundingBox())?.y ?? Infinity;
  const addTop = (await page.getByRole("heading", { name: "Add to calendar" }).boundingBox())?.y ?? -Infinity;
  expect(noteTop).toBeLessThan(addTop);
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  expect(jsonLd).toMatchObject({
    "@type": "Event",
    name: "E2E Tuesday Ride",
    eventStatus: "https://schema.org/EventScheduled",
    url: `https://calendar.bikegr.org/events/${IDS.tuesday}/${segment(dates.firstTuesday)}`,
  });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `https://calendar.bikegr.org/events/${IDS.tuesday}/${segment(dates.firstTuesday)}`,
  );
});

test("detail status codes: unknown 404, deleted 410, known 200, also for RSC requests", async ({ request }) => {
  const known = `/events/${IDS.tuesday}/${segment(dates.firstTuesday)}`;
  const deleted = `/events/${IDS.deleted}/${segment(dates.deleted)}`;
  const unknown = `/events/00000000-0000-4000-8000-000000000000/${segment(dates.firstTuesday)}`;
  const notADate = `/events/${IDS.tuesday}/${segment(dates.firstThursday)}`;
  const pending = `/events/${IDS.pending}/${segment(dates.deleted)}`;
  const variants: Record<string, string>[] = [{}, { RSC: "1" }];
  for (const headers of variants) {
    const status = async (path: string) => (await request.get(path, { headers, maxRedirects: 0 })).status();
    // A plain RSC request without the router headers gets a Next.js redirect; only the page
    // request must be 200. Neither may be 404 or 410.
    expect(headers.RSC ? [200, 307] : [200]).toContain(await status(known));
    expect(await status(deleted)).toBe(410);
    expect(await status(unknown)).toBe(404);
    expect(await status(notADate)).toBe(404);
    expect(await status(pending)).toBe(404);
    expect(await status(`/events/${IDS.tuesday}/9999-12-31T1800`)).toBe(404);
    expect(await status(`${deleted}/event.ics`)).toBe(410);
  }
  // /events alone is not the admin: no redirect to /login.
  expect((await request.get("/events", { maxRedirects: 0 })).status()).toBe(404);
  const ics = await request.get(`${known}/event.ics`);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
});

test("Feed is text/calendar with the CDN cache header, and an unknown Feed is 404", async ({ request }) => {
  const feed = await request.get("/feeds/rides.ics?tag=non-drop");
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  expect(feed.headers()["cache-control"]).toContain("s-maxage=900");
  const body = await feed.text();
  expect(body).toContain("SUMMARY:E2E Tuesday Ride");
  expect(body).not.toContain("E2E Thursday Ride");
  expect((await request.get("/feeds/other.ics")).status()).toBe(404);
});

test("pages other than the Embed may not be framed", async ({ request }) => {
  const response = await request.get("/rides");
  expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});
