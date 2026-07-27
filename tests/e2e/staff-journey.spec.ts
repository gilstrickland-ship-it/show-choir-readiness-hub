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

    // --- People: the 12 seeded students -----------------------------------
    await page.goto("/demo/roster");
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
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
    await expect(page.getByText("Total meals needed")).toBeVisible();

    // --- Multi-ensemble create (Feature 004): one competition, both ensembles →
    // attendance seeds the union of all 12 students -------------------------
    await page.goto("/demo/competitions#add");
    const compName = `Union Test ${Date.now()}`;
    const addForm = page.locator("form", { hasText: "Add competition" });
    await addForm.getByLabel("Name").fill(compName);
    await addForm.getByRole("checkbox", { name: "Varsity Mixed" }).check();
    await addForm.getByRole("checkbox", { name: "Prep" }).check();
    await addForm.getByRole("button", { name: "Add competition" }).click();

    // Lands on the new competition; attendance seeded expected for all 12.
    await page.waitForURL(/\/demo\/competitions\/[0-9a-f-]+\?created=1/);
    await expect(page.getByRole("heading", { name: compName })).toBeVisible();
    // Exact summary string — "12 expected" alone also matches the readiness rail.
    await expect(page.getByText("12 expected · 0 partial · 0 absent")).toBeVisible();
    // Both participating ensembles are shown in the header.
    await expect(
      page.locator(".chip", { hasText: "Varsity Mixed" }).first(),
    ).toBeVisible();
    await expect(page.locator(".chip", { hasText: "Prep" }).first()).toBeVisible();

    // --- Season quick-add (spec 005 US1): two fields, and you land back on the
    // spine rather than on a module list --------------------------------------
    // ?add=comp opens the drawer on its competition section server-side — the
    // same URL a failed create comes back on, so this exercises the real path.
    await page.goto("/demo/season?add=comp");
    const quickName = `Quick Add ${Date.now()}`;
    const quickAdd = page.locator("form", { hasText: "Add competition" });
    await quickAdd.getByLabel("Name").fill(quickName);
    // A past date on purpose: it keeps this row off the "next comp" slot, so it
    // disturbs neither the spine's feature row nor any other spec.
    await quickAdd.getByLabel("Date").fill("2020-03-07");
    await quickAdd.getByRole("button", { name: "Add competition" }).click();

    await page.waitForURL(/\/demo\/season\?created=comp-[0-9a-f-]+/);
    await expect(
      page.getByText("Competition added to your season."),
    ).toBeVisible();
    await expect(page.getByText(quickName)).toBeVisible();

    // --- Spine row edit (spec 005 US2): fix the date without navigating ------
    const createdKey = new URL(page.url()).searchParams.get("created") ?? "";
    await page.goto(`/demo/season?edit=${createdKey}`);
    const editPanel = page.locator("details[open] .drawer-panel");
    await editPanel.getByLabel("Date").fill("2020-03-14");
    await editPanel.getByRole("button", { name: "Save" }).click();

    // Still on Season, row re-rendered in its new position.
    await page.waitForURL(new RegExp(`/demo/season\\?saved=${createdKey}`));
    await expect(page.getByText(quickName)).toBeVisible();
  });
});
