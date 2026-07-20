import { test, expect } from "@playwright/test";
import { signIn, USERS, DEMO, resetMembershipInvited } from "./helpers";

// F3 — a director with a pending invite signs in, is routed straight to the
// accept-invite page, accepts, and lands on the demo dashboard with live data.

test.describe("invite acceptance (F3)", () => {
  test.beforeAll(async () => {
    // Guarantee the director seat is pristine-invited so the UI flow is real,
    // regardless of what other specs did to it.
    await resetMembershipInvited(DEMO.directorMembershipId);
  });

  test("director accepts the pending invite and reaches the demo dashboard", async ({
    page,
  }) => {
    await signIn(page, USERS.director.email, USERS.director.password);

    // No active membership + one pending invite → routed to /invite/<id>.
    await page.waitForURL("**/invite/**");
    const accept = page.getByRole("button", { name: "Accept invite" });
    await expect(accept).toBeVisible();
    await accept.click();

    await page.waitForURL("**/demo/dashboard");
    await expect(page.getByRole("heading", { name: /today/i })).toBeVisible();

    // Demo Show Choir data: the seeded upcoming competition + its countdown card.
    await expect(page.getByText("Next competition")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Central Illinois Invitational" }),
    ).toBeVisible();
  });
});
