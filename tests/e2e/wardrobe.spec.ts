import { test, expect } from "@playwright/test";
import { signIn, USERS, DEMO, ensureMembershipActive } from "./helpers";

// Wardrobe (spec 005 Wave W). The costume manager's four jobs — keep the
// inventory, decide who wears what, get it altered, hand it out — are four tabs,
// and the two that used to be tabs are still reachable: sets CRUD moved inside
// Assignments and the old /costumes/sets URL redirects there, and quick change
// became a printable sheet linked from Checkout.
//
// Locator contract this pins:
//   * the sub-tab strip is `.subtabs` and holds exactly four items;
//   * a row's edit control is a <summary> ("Edit" / "Assign" / "Set settings");
//   * the quick-change sheet opens with its one-line explainer.
// A CLOSED <details> still matches getByText, so every assertion below is
// scoped to a role, a summary, or a class — never bare page text that a
// collapsed panel also contains.

test.describe("wardrobe (spec 005 Wave W)", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.directorMembershipId, USERS.director.email);
  });

  test("four tabs, sets absorbed into assignments, quick change printable", async ({
    page,
  }) => {
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.waitForURL("**/demo/dashboard");

    // --- Landing: the alterations queue, four tabs -------------------------
    await page.goto("/demo/costumes");
    await expect(page.getByRole("heading", { name: "Wardrobe" })).toBeVisible();
    const tabs = page.locator(".subtabs").first();
    await expect(tabs.locator("a, strong")).toHaveCount(4);
    for (const label of ["Inventory", "Assignments", "Alterations", "Checkout"]) {
      await expect(tabs.getByText(label, { exact: true })).toBeVisible();
    }
    // The two retired tabs are gone from the strip.
    await expect(tabs.getByText("Sets", { exact: true })).toHaveCount(0);
    await expect(tabs.getByText("Quick change", { exact: true })).toHaveCount(0);

    // The queue's note is a row-local disclosure, not a permanently open input.
    await expect(
      page.locator("summary", { hasText: "Hem 1 inch" }),
    ).toBeVisible();

    // --- The old Sets URL still resolves ------------------------------------
    await page.goto("/demo/costumes/sets");
    await expect(page).toHaveURL(/\/demo\/costumes\/assignments/);

    // --- Assignments: one seeded set, so its grid opens on it ---------------
    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await expect(
      page.locator("summary", { hasText: "Set settings" }),
    ).toContainText("Opener");
    await expect(page.getByRole("link", { name: "Dress #1" })).toBeVisible();
    // Props and set pieces ride the same inventory, listed apart because they
    // skip student assignment (arch §4).
    await expect(
      page.getByRole("heading", { name: "Props & set pieces" }),
    ).toBeVisible();

    // --- Inventory: add is a drawer, filters fold, rows edit in place -------
    await page.goto("/demo/costumes/inventory");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(
      page.locator("summary", { hasText: "+ Add piece" }),
    ).toBeVisible();
    await expect(
      page.locator("summary", { hasText: "More filters" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Riser 3" })).toBeVisible();
    // Every writable row carries its own edit disclosure.
    expect(
      await page.locator("table.members summary", { hasText: "Edit" }).count(),
    ).toBeGreaterThan(0);

    // --- Checkout links the printable sheet ---------------------------------
    await page.goto("/demo/costumes/checkout");
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    await page.getByRole("link", { name: "Quick change sheet" }).click();
    await expect(page).toHaveURL(/\/demo\/costumes\/quick-change/);

    // --- The sheet teaches its own model ------------------------------------
    await expect(page.locator(".qc-explainer")).toContainText(
      "Each column is a costume change between numbers",
    );
  });
});

test.describe("costume manager seat", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.costumeMembershipId, USERS.costume.email);
  });

  test("wardrobe in nav, no roster directory", async ({ page }) => {
    await signIn(page, USERS.costume.email, USERS.costume.password);
    await page.waitForURL("**/demo/dashboard");

    const nav = page.getByRole("navigation", { name: "Program navigation" });
    await expect(nav.getByRole("link", { name: "Wardrobe" })).toBeVisible();
    // §2 matrix: no money, and no roster directory — the costume surface reads
    // sizes through its own screens, never the People list.
    await expect(nav.getByRole("link", { name: "Money" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "People" })).toHaveCount(0);

    // ACCESS, PROVEN. `getByRole("heading", { name: "Wardrobe" })` matched a
    // SUBSTRING, so the Restricted notice — whose heading is "Wardrobe is
    // outside your seat" — satisfied it too: this assertion passed whether the
    // costume manager could reach the wardrobe or was refused at the door, which
    // is the one thing it was here to tell apart. Assert what only the real page
    // has (the four-tab strip and the alterations queue), and assert the denial
    // notice is absent.
    await page.goto("/demo/costumes");
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Wardrobe", exact: true }),
    ).toBeVisible();
    const costumeTabs = page.locator(".subtabs").first();
    await expect(costumeTabs.locator("a, strong")).toHaveCount(4);
    await expect(
      costumeTabs.getByText("Assignments", { exact: true }),
    ).toBeVisible();

    // The direct roster URL renders the data-free Restricted notice, not rows.
    await page.goto("/demo/roster");
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toBeVisible();
    await expect(page.locator("table.members")).toHaveCount(0);
  });
});
