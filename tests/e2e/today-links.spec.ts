import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, DEMO, ensureMembershipActive } from "./helpers";

// ============================================================================
// Today may not send anyone to a 404 (spec 005 Wave 11 / T160).
// ----------------------------------------------------------------------------
// Today is the hub every seat lands on, and eight waves moved what it links to:
// Wave 3 replaced the competition hub's inline sections with child routes, Wave
// W deleted /costumes/alterations and re-cut the wardrobe tabs, Wave 5 moved the
// digest actions, Wave 6 restructured the student page, Wave 8 retired six tab
// components. Every one of those was a chance to leave a link behind, and a dead
// link from Today is the first thing a director meets in the morning.
//
// So this walks the links Today actually RENDERS for a seat and asks each
// destination whether it is a page. It is deliberately not a list of expected
// URLs: a list is a second copy of the page's routing that goes stale in exactly
// the same way. `?guide=open` is the URL used because a first-use journey panel
// otherwise TAKES OVER the body — with it open, the panel and the whole of Today
// render together, which is the largest link set the page has.
//
// A role-denied surface answers 200 with the data-free Restricted notice by
// design (roles.spec covers that), so what is asserted here is what a FLAG gate
// does: 404. Anything ≥400 is a link that should not have been offered.
// ============================================================================

// Every in-app link the Today section renders, deduped, fragments dropped.
// Scoped to `section.today`, so the shell nav and the mobile tab bar — whose own
// gating roles.spec pins — are not counted twice.
async function todayLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator("section.today a[href]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("href") ?? "").map((h) => h.split("#")[0]),
    );
  return [...new Set(hrefs.filter((h) => h.startsWith("/")))];
}

async function expectAllResolve(page: Page, links: string[]): Promise<void> {
  const dead: string[] = [];
  for (const href of links) {
    const res = await page.request.get(href);
    if (res.status() >= 400) dead.push(`${href} → ${res.status()}`);
  }
  expect(dead, "Today links that do not resolve").toEqual([]);
}

test.describe("Today's links all point at a real page", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.directorMembershipId, USERS.director.email);
    await ensureMembershipActive(DEMO.boardMembershipId, USERS.board.email);
  });

  test("a director's Today", async ({ page }) => {
    await signIn(page, USERS.director.email, USERS.director.password);
    await page.goto("/demo/dashboard?guide=open");
    await expect(page.getByRole("heading", { name: /today/i })).toBeVisible();

    const links = await todayLinks(page);
    // A floor, so a page that rendered nothing cannot pass by walking an empty
    // list. The director's Today carries the hero, the readiness rail, the
    // inbox and the aside cards.
    expect(links.length).toBeGreaterThan(8);
    // The two the aside promises outright, named so a silent removal shows up
    // here rather than as a quietly smaller walk.
    expect(links).toContain("/demo/events");
    expect(links).toContain("/demo/season");

    await expectAllResolve(page, links);
  });

  test("a board member's Today", async ({ page }) => {
    await signIn(page, USERS.board.email, USERS.board.password);
    await page.goto("/demo/dashboard?guide=open");
    await expect(page.getByRole("heading", { name: /today/i })).toBeVisible();

    const links = await todayLinks(page);
    expect(links.length).toBeGreaterThan(4);
    // The board orientation card is the panel `?guide=open` re-opens, and its
    // rows are gated now (T160) — on this program every flag is on, so all four
    // are here.
    expect(links).toContain("/demo/treasury");

    await expectAllResolve(page, links);
  });

  // The three comp-week tap targets render only inside the last seven days
  // before a competition, and the seeded comp is three weeks out — so the walk
  // above cannot reach them, and they are two of the routes Wave W moved. Named
  // explicitly rather than left uncovered.
  test("the comp-week hallway shortcuts resolve too", async ({ page }) => {
    await signIn(page, USERS.director.email, USERS.director.password);
    await expectAllResolve(page, [
      `/demo/competitions/${DEMO.competitionId}/attendance`,
      "/demo/costumes/checkout",
      "/demo/costumes/quick-change",
    ]);
  });
});
