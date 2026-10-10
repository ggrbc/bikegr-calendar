import { expect, test } from "@playwright/test";
import { todayInDetroit } from "@/agenda/dates";
import { fixtureDates, IDS, segment } from "./fixture";

const dates = fixtureDates(todayInDetroit(new Date()));

test("agenda for Rides shows days, and a Day filter changes the list and the URL", async ({ page }) => {
  await page.goto("/rides");
  await expect(page.getByRole("heading", { level: 1, name: "Rides & Events" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Events from / })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Thursday Ride" }).first()).toBeVisible();
  await expect(page.getByText("E2E Deleted Ride")).toHaveCount(0);
  await expect(page.getByText("E2E Pending Ride")).toHaveCount(0);

  await page.getByText("Filter", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/rides\?day=thu$/);
  await expect(page.getByRole("link", { name: "E2E Thursday Ride" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
});

test("Calendar switcher keeps the Day filter and drops a Tag that the target does not have", async ({ page }) => {
  await page.goto("/rides?day=thu&tag=non-drop");
  const nav = page.getByRole("navigation", { name: "Calendars" });
  await expect(nav.getByRole("link", { name: "Rides & Events" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Advocacy" })).toHaveAttribute("href", "/advocacy?day=thu");
  await expect(nav.getByRole("link", { name: "All" })).toHaveAttribute("href", "/?tag=non-drop&day=thu");
  await nav.getByRole("link", { name: "Advocacy" }).click();
  await expect(page).toHaveURL(/\/advocacy\?day=thu$/);
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
