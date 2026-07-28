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

    // Money is READABLE — and this has to be proved, not assumed. A `name`
    // passed to getByRole matches a SUBSTRING by default, so "Money" also
    // matched the Restricted notice's "Money is outside your seat": the
    // assertion passed whether the board member got the ledger or the door.
    // Rule out the notice, then assert something only the real page ships.
    await page.goto("/demo/treasury");
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Money", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".metric-strip")).toBeVisible();

    // ...but read-only: no add-entry affordance.
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

    // The absence queue used to be the one role-denied surface that answered
    // with a bare 404 (spec 005 T157). It answers like every other one now —
    // and, like every other one, ships none of the queue: no table, no student
    // name, no guardian email.
    await page.goto("/demo/competitions/absences");
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toBeVisible();
    await expect(page.locator("table.members")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Confirm/ }),
    ).toHaveCount(0);
  });
});

// The phone's tab bar backfills by role (spec 005 T141). It used to name four
// slots outright — Today/Season/People/Wardrobe — and simply drop any the seat
// couldn't see, so a treasurer got "Today · Season · More" and had to open the
// sheet to reach Money, the one surface her seat exists for. These journeys
// assert the bar per seat, at a phone width, because that is where it renders.

test.describe("mobile tab bar backfills by role", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.treasurerMembershipId, USERS.treasurer.email);
    await ensureMembershipActive(DEMO.boardMembershipId, USERS.board.email);
  });

  test("a treasurer gets Money as a tab, not a sheet entry", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, USERS.treasurer.email, USERS.treasurer.password);
    await page.waitForURL("**/demo/dashboard");

    const bar = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(bar).toBeVisible();
    // People and Wardrobe are not this seat's surfaces; the two slots they used
    // to hold empty go to the two surfaces she does have.
    await expect(bar.getByRole("link", { name: "Money" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Comms" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "People" })).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Wardrobe" })).toHaveCount(0);

    // ...and it is a real tab: it navigates straight to the ledger.
    await bar.getByRole("link", { name: "Money" }).click();
    await page.waitForURL("**/demo/treasury");
    await expect(
      page.getByRole("heading", { name: "Money", exact: true }),
    ).toBeVisible();
  });

  test("a director's bar is unchanged by the backfill", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.waitForURL("**/demo/dashboard");

    const bar = page.getByRole("navigation", { name: "Mobile navigation" });
    for (const label of ["Today", "Season", "People", "Wardrobe"]) {
      await expect(bar.getByRole("link", { name: label })).toBeVisible();
    }
    // Money stays in the sheet for a director — she sees every surface, so the
    // four slots are full and nothing is owed a promotion.
    await expect(bar.getByRole("link", { name: "Money" })).toHaveCount(0);
    await bar.getByRole("button", { name: "More" }).click();
    const sheet = page.locator(".mobile-nav-sheet");
    await expect(sheet.getByRole("menuitem", { name: "Money" })).toBeVisible();
  });
});
