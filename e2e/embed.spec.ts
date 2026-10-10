import { expect, type Page, test } from "@playwright/test";
import { HOST } from "./fixture";

const iframeHeight = (page: Page, index = 0) =>
  page.locator("iframe[data-bikegr-embed]").nth(index).evaluate((el) => el.getBoundingClientRect().height);

/** The height of the measured root element inside the iframe. */
const contentHeight = (page: Page, index = 0) =>
  page
    .frameLocator("iframe[data-bikegr-embed] >> nth=" + index)
    .locator("#bikegr-embed-root")
    .evaluate((el) => Math.ceil(el.getBoundingClientRect().height));

async function waitForContent(page: Page, index = 0) {
  // Chrome hydrates an off-screen cross-origin iframe only when it is in view (as a rider scrolls).
  await page.locator("iframe[data-bikegr-embed]").nth(index).scrollIntoViewIfNeeded();
  const frame = page.frameLocator("iframe[data-bikegr-embed] >> nth=" + index);
  await expect(frame.getByRole("heading", { level: 1, name: /^Events from / })).toBeVisible();
  await expect.poll(async () => Math.abs((await iframeHeight(page, index)) - (await contentHeight(page, index)))).toBeLessThan(2);
}

test("Embed shows an iframe, and its height grows to the content", async ({ page }) => {
  await page.goto(HOST);
  const iframe = page.locator("iframe[data-bikegr-embed]");
  await expect(iframe).toHaveAttribute("src", "http://localhost:3100/embed/rides");
  await waitForContent(page);
  expect(await iframeHeight(page)).toBeGreaterThan(600);
  // The Embed has no site chrome.
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await expect(frame.getByRole("navigation", { name: "Calendars" })).toHaveCount(0);
  await expect(frame.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toHaveAttribute("target", "_blank");
});

test("Embed height shrinks after one checkbox click, and the host URL gets bgr- keys", async ({ page }) => {
  await page.goto(`${HOST}/?q=host-search`);
  await waitForContent(page);
  const before = await iframeHeight(page);
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await frame.getByText("Filter", { exact: true }).click();
  await frame.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await expect(frame.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  // The host page's own q is never read or deleted; the Embed writes only bgr- keys.
  await expect(page).toHaveURL(`${HOST}/?q=host-search&bgr-day=thu`);
  await waitForContent(page);
  expect(await iframeHeight(page)).toBeLessThan(before);
});

test("a host URL with ?bgr-day=tue opens the Embed filtered; the host's own q is not read", async ({ page }) => {
  await page.goto(`${HOST}/?bgr-day=tue&q=thursday&other=kept`);
  await expect(page.locator("iframe[data-bikegr-embed]")).toHaveAttribute(
    "src",
    "http://localhost:3100/embed/rides?day=tue",
  );
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await expect(frame.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
  await expect(frame.getByRole("link", { name: "E2E Thursday Ride" })).toHaveCount(0);
  // The first load does not change the host URL.
  await expect(page).toHaveURL(`${HOST}/?bgr-day=tue&q=thursday&other=kept`);
});

test("two days in the host URL are written with a plain comma", async ({ page }) => {
  await page.goto(HOST);
  await waitForContent(page);
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await frame.getByText("Filter", { exact: true }).click();
  await frame.getByRole("checkbox", { name: "Wed", exact: true }).check();
  await expect(page).toHaveURL(`${HOST}/?bgr-day=wed`);
  await frame.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await expect(page).toHaveURL(`${HOST}/?bgr-day=wed,thu`);
});

test("short filter keys on the host URL are not Embed keys", async ({ page }) => {
  await page.goto(`${HOST}/?day=tue&q=x`);
  await expect(page.locator("iframe[data-bikegr-embed]")).toHaveAttribute("src", "http://localhost:3100/embed/rides");
});

test("a fake resize message from the host page itself does not change the height", async ({ page }) => {
  await page.goto(HOST);
  await waitForContent(page);
  const before = await iframeHeight(page);
  await page.evaluate(() => window.postMessage({ type: "bikegr-calendar:resize", height: 5 }, "*"));
  await page.waitForTimeout(300);
  expect(await iframeHeight(page)).toBe(before);
});

test("two Embeds in a 360 px column: no horizontal scroll, data-filters applied, no host URL sync", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${HOST}/two.html`);
  const frames = page.locator("iframe[data-bikegr-embed]");
  await expect(frames).toHaveCount(2);
  await expect(frames.nth(1)).toHaveAttribute("src", "http://localhost:3100/embed/advocacy?tag=meeting");
  await waitForContent(page, 0);
  await waitForContent(page, 1);
  for (const index of [0, 1]) {
    const overflow = await page
      .frameLocator(`iframe[data-bikegr-embed] >> nth=${index}`)
      .locator("html")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  const advocacy = page.frameLocator("iframe[data-bikegr-embed] >> nth=1");
  await expect(advocacy.getByText("E2E Commission Meeting")).toBeVisible();
  await page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByText("Filter", { exact: true }).click();
  await page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByRole("checkbox", { name: "Thu", exact: true }).check();
  await expect(page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  await expect(page).toHaveURL(`${HOST}/two.html`);
});

test("the Embed has no Feed line; the site page keeps it", async ({ page }) => {
  await page.goto("/embed/rides");
  await expect(page.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Subscribe in your calendar app" })).toHaveCount(0);
  await expect(page.getByText("Feed URL:")).toHaveCount(0);

  await page.goto("/rides");
  await expect(page.getByRole("link", { name: "Subscribe in your calendar app" })).toBeVisible();
});

test("Embed response has the frame-ancestors header for the allowed hosts", async ({ request }) => {
  const response = await request.get("/embed/rides");
  expect(response.headers()["content-security-policy"]).toBe(
    `frame-ancestors 'self' https://www.bikegr.org https://bikegr.org https://*.squarespace.com ${HOST}`,
  );
});
