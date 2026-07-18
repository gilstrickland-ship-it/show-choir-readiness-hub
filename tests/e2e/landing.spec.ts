import { test, expect } from "@playwright/test";

// F4b — public landing + the friendly link-expired surface. No auth, no seed
// state beyond what's always present.

test.describe("landing", () => {
  test("hero renders and 'Staff sign in' routes to /sign-in", async ({ page }) => {
    await page.goto("/");
    // Hero tagline is brand-agnostic copy (the h1 is the env-driven brand name).
    await expect(
      page.getByText("The season operating system for competitive show choir."),
    ).toBeVisible();

    const signIn = page.getByRole("link", { name: "Staff sign in" }).first();
    await expect(signIn).toBeVisible();
    await signIn.click();
    await page.waitForURL("**/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("an invalid token shows the link-expired copy, not a 404", async ({
    page,
  }) => {
    await page.goto("/t/garbage-token");
    await expect(page.getByText("This link is no longer active")).toBeVisible();
    // Must NOT be the framework 404 nor the app's own not-found page.
    await expect(page.getByText(/could not be found/i)).toHaveCount(0);
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });
});
