import { expect, test } from "@playwright/test";
import { enterAsRole } from "./helpers";

test("blank sign-in reaches join flow", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Get into your choir fast" })).toBeVisible();

  await page.getByTestId("sign-in-continue").click();

  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByRole("heading", { name: "Choose your role" })).toBeVisible();
});

test("student quick join reaches student home", async ({ page }) => {
  await enterAsRole(page, "Student");
  await expect(page).toHaveURL(/\/student\/home$/);
  await expect(page.getByRole("heading", { name: "Student Mode" })).toBeVisible();
});

test("parent quick join reaches parent home", async ({ page }) => {
  await enterAsRole(page, "Parent");
  await expect(page).toHaveURL(/\/parent\/home$/);
  await expect(page.getByRole("heading", { name: "Parent Mode" })).toBeVisible();
});

test("leader quick join reaches leader dashboard", async ({ page }) => {
  await enterAsRole(page, "Leader");
  await expect(page).toHaveURL(/\/leader\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Program Overview" })).toBeVisible();
});
