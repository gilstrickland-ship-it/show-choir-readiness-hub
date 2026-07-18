import { test, expect } from "@playwright/test";
import { signIn, USERS, DEMO, ensureMembershipActive } from "./helpers";

// Demo director day-to-day: roster, competitions, itinerary, the staff parent
// packet PDF, an attendance toggle round trip, and meal headcounts.

test.describe("staff journey (demo director)", () => {
  test.beforeAll(async () => {
    // Re-run-safe: ensure the director seat is active (accepted) via admin so
    // this spec stands alone even if the invite UI flow hasn't run.
    await ensureMembershipActive(DEMO.directorMembershipId, USERS.director.email);
  });

  test("director works the demo program", async ({ page }) => {
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.waitForURL("**/demo/dashboard");

    // --- Roster: the 12 seeded students -----------------------------------
    await page.goto("/demo/roster");
    await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
    await expect(page.locator("table.members tbody tr")).toHaveCount(12);
    await expect(
      page.getByRole("link", { name: "Bennett, Ava" }),
    ).toBeVisible();

    // --- Competitions list -------------------------------------------------
    await page.goto("/demo/competitions");
    await expect(
      page.getByRole("link", { name: "Central Illinois Invitational" }),
    ).toBeVisible();

    // --- Itinerary is published -------------------------------------------
    await page.goto(`/demo/competitions/${DEMO.competitionId}/itinerary`);
    await expect(
      page.locator(".badge", { hasText: "published" }),
    ).toBeVisible();

    // --- Staff parent packet PDF (auth cookies via page.request) -----------
    const packet = await page.request.get(
      `/api/pdf/packet?competition=${DEMO.competitionId}`,
    );
    expect(packet.status()).toBe(200);
    expect(packet.headers()["content-type"]).toContain("application/pdf");

    // --- Attendance: toggle a student absent, then back (net zero) ---------
    // Use Liam Carter — Ava is the parent-token spec's subject, keep them apart.
    await page.goto(`/demo/competitions/${DEMO.competitionId}/attendance`);
    const liam = () => page.locator("li", { hasText: "Carter, Liam" });
    await expect(liam()).toContainText("(expected)");
    await liam().getByRole("button", { name: "Absent" }).click();
    await expect(liam()).toContainText("(absent)");
    await liam().getByRole("button", { name: "Expected" }).click();
    await expect(liam()).toContainText("(expected)");

    // --- Meals: headcounts render -----------------------------------------
    await page.goto(`/demo/competitions/${DEMO.competitionId}/meals`);
    await expect(page.getByRole("heading", { name: "Meal count" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Headcount by ensemble" }),
    ).toBeVisible();
    await expect(page.getByText(/meals needed/)).toBeVisible();
  });
});
