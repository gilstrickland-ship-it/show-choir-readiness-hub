import { test, expect } from "@playwright/test";
import { signIn, USERS, DEMO, ensureMembershipActive } from "./helpers";

// Host-mode (spec 005 Wave 7) is the one surface this suite cannot walk: the
// `hosting` flag defaults to OFF and no tier bundle turns it on (lib/flags.ts —
// a deliberate product decision), so the demo program has no invitational to
// open. What it CAN pin — and what matters more than any of the flows — is the
// posture that decision rests on: a program without the flag must never learn
// the feature exists. Not hidden in the nav and reachable by URL; gone.
//
// This is the guard for that, and it is deliberately narrow: if someone flips
// the registry default, adds `hosting` to a tier bundle, or drops the
// `requireFlag` call at the top of either page, this test fails. Turning the
// flag on for the demo program instead — to exercise the sections — would erase
// the very thing being tested, so the flows stay covered by the unit suite
// (tests/unit/hosting.spec.ts, tests/unit/hosting-shared.spec.ts) until host
// mode leaves pilot.

test.describe("host mode is invisible without the flag", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(
      DEMO.directorMembershipId,
      USERS.director.email,
    );
  });

  test("no nav slot, and both hosting URLs 404 for the demo director", async ({
    page,
  }) => {
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.waitForURL("**/demo/dashboard");

    // The director has the seat (HOSTING_ROLES) — only the flag is off, so this
    // proves the FLAG gate rather than the role gate.
    const nav = page.getByRole("navigation", { name: "Program navigation" });
    await expect(nav.getByRole("link", { name: "Hosting" })).toHaveCount(0);

    // A guessed URL is a 404, not a role-denied Restricted notice: the notice
    // names the seats that own a surface, which would itself disclose that host
    // mode is there to be turned on.
    const list = await page.goto("/demo/hosting");
    expect(list?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /outside your seat/i }),
    ).toHaveCount(0);

    // Same for an event URL — the flag check runs before the row is loaded, so
    // a made-up id 404s exactly like a real one would.
    const event = await page.goto(
      "/demo/hosting/d0000000-0000-4000-8000-0000000009ff",
    );
    expect(event?.status()).toBe(404);
  });
});
