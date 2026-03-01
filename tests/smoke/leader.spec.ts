import { expect, test } from "@playwright/test";
import { enterAsRole } from "./helpers";

test("leader can navigate dashboard, publish, and settings", async ({ page }) => {
  await enterAsRole(page, "Leader");
  await expect(page).toHaveURL(/\/leader\/dashboard$/);
  const leaderNav = page.locator(".leader-header-actions");

  await leaderNav.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Program Overview" })).toBeVisible();

  await leaderNav.getByRole("link", { name: "Publish", exact: true }).click();
  await expect(page).toHaveURL(/\/leader\/publish$/);
  await expect(page.getByRole("heading", { name: "Publish Updates" })).toBeVisible();

  await leaderNav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/leader\/settings$/);
  await expect(page.getByRole("heading", { name: "Program Settings" })).toBeVisible();
});

test("leader can edit and delete items from the dashboard", async ({ page }) => {
  await enterAsRole(page, "Leader");
  await expect(page).toHaveURL(/\/leader\/dashboard$/);

  await page.getByTestId("event-edit-first").click();
  const drawer = page.getByTestId("leader-drawer");
  await expect(drawer).toBeVisible();

  const eventTitle = drawer.getByLabel("Title");
  await eventTitle.fill("Updated Event Title");
  await page.getByTestId("drawer-save").click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText("Updated Event Title")).toBeVisible();

  const taskDeleteButtons = page
    .locator(".leader-panel")
    .nth(3)
    .getByRole("button", { name: "Delete" });
  const beforeCount = await taskDeleteButtons.count();
  await taskDeleteButtons.first().click();
  await expect
    .poll(async () => page.locator(".leader-panel").nth(3).getByRole("button", { name: "Delete" }).count())
    .toBe(beforeCount - 1);
});

test("leader can publish an update and see it on the dashboard", async ({ page }) => {
  await enterAsRole(page, "Leader");
  await page
    .locator(".leader-header-actions")
    .getByRole("link", { name: "Publish", exact: true })
    .click();

  await page.getByLabel("Title").fill("Smoke Test Update");
  await page.getByLabel("Summary").fill("This update was created by the Playwright smoke suite.");
  await page.getByRole("button", { name: "Publish update" }).click();

  await page
    .locator(".leader-header-actions")
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await expect(page.getByText("Smoke Test Update")).toBeVisible();
});

test("leader can save settings, import users, search, and remove an imported user", async ({ page }) => {
  await enterAsRole(page, "Leader");
  await page
    .locator(".leader-header-actions")
    .getByRole("link", { name: "Settings", exact: true })
    .click();

  await page.getByLabel("Program name").fill("Smoke Test Program");
  await page.locator('input[type="color"]').first().fill("#112233");
  await page.locator('input[type="color"]').nth(1).fill("#dd8844");
  await page.getByTestId("settings-save").click();
  await expect(page.getByText(/Settings saved\./)).toBeVisible();

  await page.getByLabel("Spreadsheet rows").fill(
    "Taylor Example, taylor@example.com, student, Premiere|Spectrum"
  );
  await page.getByTestId("user-import").click();
  await expect(page.getByText(/Imported 1 user/)).toBeVisible();

  await page.getByTestId("user-search").fill("Taylor Example");
  const userCards = page.locator(".leader-manage-card");
  await expect(userCards).toHaveCount(1);
  const userCard = userCards.first();
  await expect(userCard.getByLabel("Name")).toHaveValue("Taylor Example");

  await userCard.getByRole("button", { name: "Remove" }).click();
  await expect(userCard).toHaveCount(0);
});
