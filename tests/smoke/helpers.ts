import { expect, Page } from "@playwright/test";

export async function enterAsRole(page: Page, role: "Student" | "Parent" | "Leader") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await page.getByTestId("sign-in-continue").click();
  await expect(page).toHaveURL(/\/join$/);
  await page.getByTestId(`join-${role.toLowerCase()}`).click();
}
