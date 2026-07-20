import { test, expect } from "@playwright/test";
import {
  signIn,
  USERS,
  DEMO,
  readState,
  ensureMembershipActive,
  resetDemoParentState,
} from "./helpers";

// F13 / F15 / F16 — the tokenized parent surface and its staff round trips:
// family home, published itinerary + packet PDF, a volunteer shift claim/cancel,
// and an absence request that a director confirms, flipping the parent view to
// "Confirmed".

test.describe("parent token journeys (F13/F15/F16)", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.directorMembershipId, USERS.director.email);
    await resetDemoParentState();
  });

  test("family surface + staff confirmation round trip", async ({ page }) => {
    const token = readState().guardianRawToken;
    const base = `/t/${token}`;

    // --- Family home (poster) lists the Bennett student --------------------
    await page.goto(base);
    // The redesigned family home leads with the "Next competition" hero and a
    // per-student costume card (no "Your family" heading) — assert the student
    // card, which is the stable anchor for the family surface.
    await expect(
      page.getByRole("heading", { name: "Ava Bennett" }),
    ).toBeVisible();

    // --- Published itinerary + packet PDF ----------------------------------
    await page.goto(`${base}/itinerary`);
    await expect(
      page.getByRole("heading", { name: /Central Illinois Invitational/ }),
    ).toBeVisible();
    const packetLink = page.getByRole("link", {
      name: "Download packet (PDF)",
    });
    await expect(packetLink).toBeVisible();
    const packetHref = await packetLink.getAttribute("href");
    expect(packetHref).toBeTruthy();
    const packet = await page.request.get(packetHref!);
    expect(packet.status()).toBe(200);
    expect(packet.headers()["content-type"]).toContain("application/pdf");

    // --- Volunteer signup: claim the Lunch shift, then cancel --------------
    await page.goto(`${base}/signup`);
    const shift = () => page.locator(".confirm-box", { hasText: "Meal crew" });
    await shift().getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("You're signed up. Thank you!")).toBeVisible();
    await shift().getByRole("button", { name: "Cancel my signup" }).click();
    await expect(page.getByText("Your signup was cancelled.")).toBeVisible();

    // --- Absence request for Ava + the competition -------------------------
    await page.goto(`${base}/absence`);
    await page.getByLabel("Student").selectOption({ label: "Ava Bennett" });
    await page.getByLabel("Competition").selectOption({ index: 0 });
    await page.getByRole("button", { name: "Submit absence report" }).click();
    await expect(page.getByText(/absence report was sent/i)).toBeVisible();
    // The parent absence history is stacked cards now (not a table) — the phone
    // surface. Each request is a `.token-report-card` carrying its status label.
    await expect(
      page.locator(".token-report-card", { hasText: "Pending review" }),
    ).toBeVisible();

    // --- As staff (director): the queue shows it; Confirm flips it ----------
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.waitForURL("**/demo/dashboard");
    await page.goto("/demo/competitions/absences");
    const queueRow = page.locator("table.members tbody tr", {
      hasText: "Ava Bennett",
    });
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Absence confirmed")).toBeVisible();

    // --- Parent view now reads Confirmed -----------------------------------
    await page.goto(`${base}/absence`);
    await expect(
      page.locator(".token-report-card", { hasText: "Confirmed" }),
    ).toBeVisible();
  });
});
