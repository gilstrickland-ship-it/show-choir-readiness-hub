import { expect, test } from "@playwright/test";
import { enterAsRole } from "./helpers";

test("student can navigate tabs and persist a task toggle", async ({ page }) => {
  await enterAsRole(page, "Student");
  await expect(page).toHaveURL(/\/student\/home$/);

  await page.getByRole("link", { name: "Queue" }).click();
  await expect(page).toHaveURL(/\/student\/queue$/);
  await expect(page.getByRole("heading", { name: /pending tasks/i })).toBeVisible();

  const firstTask = page.locator(".queue-card").first();
  await expect(firstTask).toBeVisible();
  const firstTaskTitle = await firstTask.locator("strong").innerText();
  await firstTask.click();
  await expect(
    page.locator(".queue-card-complete").filter({ hasText: firstTaskTitle }).first()
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/student\/queue$/);
  await expect(
    page.locator(".queue-card-complete").filter({ hasText: firstTaskTitle }).first()
  ).toBeVisible();

  await page.getByRole("link", { name: "Updates" }).click();
  await expect(page).toHaveURL(/\/student\/updates$/);
  await expect(page.getByRole("heading", { name: /what changed since you last checked/i })).toBeVisible();

  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL(/\/student\/guide$/);
  await expect(page.getByText("Competition guide")).toBeVisible();

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/student\/home$/);
  await expect(page.getByRole("heading", { name: "Student Mode" })).toBeVisible();
});
