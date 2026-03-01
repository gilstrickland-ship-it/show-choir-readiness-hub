import { expect, test } from "@playwright/test";
import { enterAsRole } from "./helpers";

test("parent can navigate parent views", async ({ page }) => {
  await enterAsRole(page, "Parent");
  await expect(page).toHaveURL(/\/parent\/home$/);
  await expect(page.getByRole("heading", { name: "Parent Mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("link", { name: "Updates" }).click();
  await expect(page).toHaveURL(/\/parent\/updates$/);
  await expect(page.getByRole("heading", { name: /choir logistics only/i })).toBeVisible();

  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL(/\/parent\/guide$/);
  await expect(page.getByText("Event logistics")).toBeVisible();

  await page.goto("/parent/guide");
  await expect(page.getByText("Event logistics")).toBeVisible();

  await expect(page.getByText("Program Settings")).toHaveCount(0);
});
