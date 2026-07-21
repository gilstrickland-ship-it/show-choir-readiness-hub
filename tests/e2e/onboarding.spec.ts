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

    // Brand-new program → the first-run "Set up your program" guide replaces the
    // old "No active season yet." alert. Its first step links to the season
    // rollover wizard ("Start your season").
    await expect(
      page.getByRole("heading", { name: "Set up your program" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start your season" }),
    ).toBeVisible();

    // Start + activate season "2026-27". With no prior season, the wizard
    // fast-paths from create straight to activate — the ensembles/students/
    // costumes carry-forward steps have no source data and are skipped.
    await page.goto("/e2e-test-program/settings/rollover");
    await page.getByLabel("Season label").fill("2026-27");
    await page.getByRole("button", { name: /Create season/ }).click();
    await page.waitForURL(/step=activate/);

    // First-season branch labels the button "Activate season" (not "Activate
    // new season") — there's no prior active season to deactivate.
    await page.getByRole("button", { name: "Activate season" }).click();
    await page.waitForURL(/step=archive/);
    await expect(
      page.getByText("2026-27 is now your active season"),
    ).toBeVisible();

    // Dashboard now reflects the active season. The label renders in the app-shell
    // header, and — the program still being materially empty (a season but no
    // students/ensembles/competitions) — the first-run guide still shows (not the
    // competition hero), now with its "Start your season" step marked done.
    await page.goto("/e2e-test-program/dashboard");
    await expect(page.getByText("2026-27").first()).toBeVisible();
    await expect(page.getByText("No active season yet.")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Set up your program" }),
    ).toBeVisible();
    await expect(
      page.locator(".setup-step.done", { hasText: "Start your season" }),
    ).toBeVisible();
  });
});
