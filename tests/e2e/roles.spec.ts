import { test, expect } from "@playwright/test";
import { signIn, USERS, DEMO, ensureMembershipActive } from "./helpers";

// Role gating (§2 matrix) — a board member: read-only treasury (no add-entry
// form), no comms in nav, and a direct comms URL renders the data-free
// Restricted notice (role-denied members no longer get a bare 404).

test.describe("board member role gating", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.boardMembershipId, USERS.board.email);
  });

  test("board member sees read-only treasury and no comms", async ({ page }) => {
    await signIn(page, USERS.board.email, USERS.board.password);
    await page.waitForURL("**/demo/dashboard");
    await expect(page.getByRole("heading", { name: /today/i })).toBeVisible();

    // New task-oriented IA: Treasury → "Money"; Comms stays off the board's
    // surface (COMMS_ROLES excludes board_member).
    const nav = page.getByRole("navigation", { name: "Program navigation" });
    await expect(nav.getByRole("link", { name: "Money" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Comms" })).toHaveCount(0);

    // Money is readable but read-only — no add-entry affordance.
    await page.goto("/demo/treasury");
    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Add an entry" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add entry" }),
    ).toHaveCount(0);

    // Comms is off the board's surface entirely. The direct URL no longer 404s
    // for an authenticated member — it renders the data-free Restricted notice
    // (names the owning seats, but ships none of the surface's content).
    await page.goto("/demo/comms");
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toBeVisible();
    // Still no leak: none of the comms surface (e.g. its Digest tab) renders.
    await expect(page.getByRole("link", { name: "Digest" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Add an entry" }),
    ).toHaveCount(0);
  });
});
