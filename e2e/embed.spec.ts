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
  await expect(frame.locator("h2").first()).toBeVisible();
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

test("Embed height shrinks after a filter with fewer results, and the host URL gets the filter", async ({ page }) => {
  await page.goto(HOST);
  await waitForContent(page);
  const before = await iframeHeight(page);
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await frame.getByText("Filter events").click();
  await frame.getByRole("checkbox", { name: "Thu", exact: true }).check();
  await frame.getByRole("button", { name: "Apply" }).click();
  await expect(frame.getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  await expect(page).toHaveURL(`${HOST}/?day=thu`);
  await waitForContent(page);
  expect(await iframeHeight(page)).toBeLessThan(before);
});

test("a host URL with ?day=tue opens the Embed filtered", async ({ page }) => {
  await page.goto(`${HOST}/?day=tue&other=kept`);
  await expect(page.locator("iframe[data-bikegr-embed]")).toHaveAttribute("src", "http://localhost:3100/embed/rides?day=tue");
  const frame = page.frameLocator("iframe[data-bikegr-embed]");
  await expect(frame.getByRole("link", { name: "E2E Tuesday Ride" }).first()).toBeVisible();
  await expect(frame.getByRole("link", { name: "E2E Thursday Ride" })).toHaveCount(0);
  // The first load does not change the host URL.
  await expect(page).toHaveURL(`${HOST}/?day=tue&other=kept`);
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
  await page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByText("Filter events").click();
  await page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByRole("checkbox", { name: "Thu", exact: true }).check();
  await page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByRole("button", { name: "Apply" }).click();
  await expect(page.frameLocator("iframe[data-bikegr-embed] >> nth=0").getByRole("link", { name: "E2E Tuesday Ride" })).toHaveCount(0);
  await expect(page).toHaveURL(`${HOST}/two.html`);
});

test("Embed response has the frame-ancestors header for the allowed hosts", async ({ request }) => {
  const response = await request.get("/embed/rides");
  expect(response.headers()["content-security-policy"]).toBe(
    `frame-ancestors 'self' https://www.bikegr.org https://bikegr.org https://*.squarespace.com ${HOST}`,
  );
});
