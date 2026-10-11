/**
 * Editors: the four-column list, the Admin's edit page (rename, role, deactivate), the account page
 * for every role, and the Admin-only rule. Sessions come from global setup. Screenshots go to the
 * gitignored `.scratch/` folder.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { E2E_ADMIN, E2E_EDITOR, E2E_SELF, E2E_TARGET } from "./fixture";

const logIn = (context: BrowserContext, sessionToken: string) =>
  context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true }]);

const SHOTS = ".scratch/editors";
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

const nameInput = (page: Page) => page.getByRole("textbox", { name: "Name", exact: true });
const roleSelect = (page: Page) => page.getByRole("combobox", { name: "Role", exact: true });
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

test.describe("as an Admin", () => {
  test.beforeEach(async ({ context }) => logIn(context, E2E_ADMIN.sessionToken));

  test("the list has four columns and an Edit button on every row, the Admin's own included", async ({ page }) => {
    await page.goto("/admin/editors");
    await expect(page.getByRole("heading", { level: 1, name: "Editors" })).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText(["Editor", "Role", "Status", "Actions"]);
    // No forms and no dates in the list.
    await expect(page.locator("table select")).toHaveCount(0);
    await expect(page.locator("table button")).toHaveCount(0);
    await expect(row(page, E2E_ADMIN.email).getByRole("link", { name: /^Edit/ })).toHaveAttribute(
      "href",
      `/admin/editors/${E2E_ADMIN.id}`,
    );
    await expect(row(page, E2E_EDITOR.email).getByText("Active")).toBeVisible();
    await expect(row(page, "deactivated.editor").getByText("Deactivated", { exact: true })).toBeVisible();
    await shoot(page, "list");
  });

  test("renames an Editor, changes the role, and deactivates and reactivates from the edit page", async ({ page }) => {
    await page.goto("/admin/editors");
    await row(page, E2E_TARGET.email).getByRole("link", { name: /^Edit/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: E2E_TARGET.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Editors" })).toBeVisible();
    const details = page.getByRole("region", { name: "Details" });
    await expect(details).toContainText(E2E_TARGET.email);
    await expect(details).toContainText(`by ${E2E_ADMIN.name}`);
    await shoot(page, "edit");

    // Rename.
    await nameInput(page).fill("Renamed By Admin");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect(page.getByRole("heading", { level: 1, name: "Renamed By Admin" })).toBeVisible();

    // An empty name is refused by the server too (skip the browser's required check).
    await nameInput(page).evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
    await nameInput(page).fill("   ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Enter a name.");

    // Role.
    await nameInput(page).fill("Renamed By Admin");
    await roleSelect(page).selectOption("admin");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("is now an Admin");
    await roleSelect(page).selectOption("editor");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("is now an Editor");

    // Deactivate (the confirm dialog), then reactivate.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("is deactivated and signed out")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
    await expect(roleSelect(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("is active again")).toBeVisible();

    // The list shows the new name.
    await page.getByRole("link", { name: "← Editors" }).click();
    await expect(row(page, E2E_TARGET.email).locator("div.font-semibold")).toHaveText("Renamed By Admin");
    await expect(row(page, E2E_TARGET.email).getByText("Active")).toBeVisible();
  });

  test("the Admin's own edit page has the name only", async ({ page }) => {
    await page.goto(`/admin/editors/${E2E_ADMIN.id}`);
    await expect(page.getByRole("region", { name: "Details" })).toBeVisible();
    await expect(nameInput(page)).toHaveValue(E2E_ADMIN.name);
    await expect(roleSelect(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Deactivate|Reactivate/ })).toHaveCount(0);
  });

  test("a bad or unknown id is a 404", async ({ page }) => {
    for (const id of ["not-an-id", "20000000-0000-4000-8000-0000000000ff"]) {
      // The page streams inside Suspense, so the status is already 200; Next shows its not-found page.
      await page.goto(`/admin/editors/${id}`);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByRole("region", { name: "Details" })).toHaveCount(0);
    }
  });

  test("the invite form needs a name", async ({ page }) => {
    await page.goto("/admin/editors");
    await expect(nameInput(page)).toHaveAttribute("required", "");
  });

  test("the account page shows the Admin's email and role", async ({ page }) => {
    await page.goto("/admin/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByText(E2E_ADMIN.email)).toBeVisible();
    await shoot(page, "account");
  });
});

test.describe("as an Editor (not Admin)", () => {
  test.beforeEach(async ({ context }) => logIn(context, E2E_SELF.sessionToken));

  test("renames themselves on the account page, and the header shows the new name", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: E2E_SELF.name }).click();
    await expect(page).toHaveURL(/\/admin\/account$/);
    await expect(page.getByText(E2E_SELF.email)).toBeVisible();
    await expect(page.getByText("Editor", { exact: true }).first()).toBeVisible();
    await nameInput(page).fill("Self Renamed");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect(page.getByRole("banner").getByRole("link", { name: "Self Renamed" })).toBeVisible();
  });

  test("cannot open an edit page or the list", async ({ page }) => {
    for (const path of [`/admin/editors/${E2E_TARGET.id}`, `/admin/editors/${E2E_SELF.id}`, "/admin/editors"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin$/);
    }
  });
});
