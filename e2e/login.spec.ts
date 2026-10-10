/**
 * The Editor sign-in page. The e2e server has no Google client (playwright.config.ts sets
 * `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` empty), so the page shows the magic link only. The
 * Google flow itself is tested through the real Auth.js handler in src/auth/config.test.ts.
 */
import { expect, test } from "@playwright/test";

test("/login has the bikegr.org header and the email form, and no Google button when Google is not configured", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /donate/i }).first()).toBeVisible();
  await expect(page.getByText("Editors sign in with a link sent by email.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
});

test("an email that is not an Editor gets the neutral sent message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("stranger@example.org");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If stranger@example.org belongs to an Editor, we sent a sign-in link.");
});

for (const [error, message] of [
  ["AccessDenied", "You cannot sign in with this email. Ask an Admin."],
  ["OAuthAccountNotLinked", "You are signed in as another Editor. Sign out first, then sign in with Google."],
  ["OAuthCallbackError", "Google sign-in did not finish. Try again, or get a link by email."],
] as const) {
  test(`/login?error=${error} shows its message`, async ({ page }) => {
    await page.goto(`/login?error=${error}`);
    await expect(page.getByRole("alert")).toHaveText(message);
  });
}
