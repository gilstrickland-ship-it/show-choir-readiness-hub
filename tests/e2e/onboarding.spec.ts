import { test, expect } from "@playwright/test";
import { signIn, USERS, cleanupFounderPrograms } from "./helpers";

// F1 — a fresh account with no membership creates a program (becoming its
// director) and starts its first season. Since spec 005 US3 that is one submit
// on the Season page's "Start your season" card, not a trip through the
// six-step rollover wizard (which is now rollover-only).

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
    // old "No active season yet." alert. Its first step now links to Season,
    // where the start-season card lives (the heading and step-1 label are the
    // preserved guide contract).
    await expect(
      page.getByRole("heading", { name: "Set up your program" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start your season" }),
    ).toBeVisible();

    // One card, one field, one submit: create AND activate "2026-27".
    await page.getByRole("link", { name: "Start your season" }).click();
    await page.waitForURL("**/e2e-test-program/season");
    await expect(
      page.getByRole("heading", { name: "Start your season" }),
    ).toBeVisible();
    await page.getByLabel("Season name").fill("2026-27");
    await page.getByRole("button", { name: "Start season" }).click();

    // Back on Season, season live — no wizard, no second step.
    await page.waitForURL(/\/e2e-test-program\/season\?seasonStarted=1/);
    await expect(
      page.getByText("2026-27 is now your active season"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Start your season" }),
    ).toHaveCount(0);

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

    // Spec 005 Wave 9: the guide traces the REBUILT create path. Adding a
    // competition is the Season "+ Add" drawer (US1), so the step's href is
    // `/season?add=comp` and following it lands with that drawer already open —
    // not on the /competitions module page, and not on an `#add` anchor.
    const compStep = page.getByRole("link", {
      name: "Add your first competition",
    });
    await expect(compStep).toHaveAttribute(
      "href",
      "/e2e-test-program/season?add=comp",
    );
    await compStep.click();
    await page.waitForURL(/\/e2e-test-program\/season\?add=comp/);
    await expect(
      page.getByRole("heading", { name: "Add to the season" }),
    ).toBeVisible();
  });
});
