import { test, expect } from "@playwright/test";
import { signIn, USERS, cleanupFounderPrograms } from "./helpers";

// F1 — a fresh account with no membership creates a program (becoming its
// director) and starts its first season through the rollover wizard.

test.describe("onboarding (F1)", () => {
  test.beforeAll(async () => {
    await cleanupFounderPrograms();
  });

  test("fresh founder creates a program and activates a season", async ({
    page,
  }) => {
    await signIn(page, USERS.founder.email, USERS.founder.password);

    // No membership → the honest "Start your program" empty state on /launch.
    await page.waitForURL("**/launch");
    await expect(
      page.getByRole("heading", { name: "Start your program" }),
    ).toBeVisible();

    // Create the program (timezone default America/Chicago is fine).
    await page.getByLabel("Program name").fill("E2E Test Program");
    await page.getByRole("button", { name: "Create program" }).click();
    await page.waitForURL("**/e2e-test-program/dashboard");

    // No-season empty state.
    await expect(page.getByText("No active season yet.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start a season" }),
    ).toBeVisible();

    // Walk the rollover wizard to create + activate season "2026-27".
    await page.goto("/e2e-test-program/settings/rollover");
    await page.getByLabel("Season label").fill("2026-27");
    await page.getByRole("button", { name: /Create season/ }).click();
    await page.waitForURL(/step=ensembles/);

    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/step=students/);

    await page.getByRole("button", { name: /Save/ }).click();
    await page.waitForURL(/step=costumes/);

    await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForURL(/step=activate/);

    await page.getByRole("button", { name: "Activate new season" }).click();
    await page.waitForURL(/step=archive/);
    await expect(
      page.getByText("2026-27 is now your active season"),
    ).toBeVisible();

    // Dashboard now reflects the active season.
    await page.goto("/e2e-test-program/dashboard");
    await expect(page.getByText("2026-27").first()).toBeVisible();
    await expect(page.getByText("No active season yet.")).toHaveCount(0);
  });
});
