import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  signIn,
  USERS,
  DEMO,
  ensureMembershipActive,
  resetDemoCommitments,
  setDemoSpendingRules,
} from "./helpers";

// ============================================================================
// Commitments (spec 006) — the anti-fraud claim, proved from outside the app
// ----------------------------------------------------------------------------
// Everything else about this feature is arithmetic. This is the part that has to
// be true: the person who asks for the money is not the person who approves it,
// and above the amount a program writes down, one approval is not enough.
//
// Both of those are enforced by the DATABASE (a CHECK constraint, a trigger, and
// one SECURITY DEFINER function — tests/rls/commitments.spec.ts holds those to
// account). What is proved HERE is the half a treasurer actually meets: that the
// button is not there, that the sentence explaining why is, and that a real
// two-seat walk — director asks, treasurer approves, treasurer pays, treasurer
// closes — goes all the way through in a browser.
//
// TWO SEATS MEANS TWO BROWSER CONTEXTS. Signing a second person in on the same
// page would just replace the first one's session, and the whole point is that
// the two acts are done by two people. Each context holds its own cookies, so
// the director's page and the treasurer's page are open at once, which is also
// how it happens in the real world.
//
// LOCATOR CONTRACT (the substring lesson — CI has broken on it four times):
//   * a row's Open control is a LINK whose accessible name is
//     "Open <ref> — <vendor>", so it is addressed by the vendor;
//   * the open panel is `.table-panel`, and every assertion about one
//     commitment is scoped to it — a closed <details> elsewhere on the page
//     still matches getByText;
//   * the add drawers are <summary> elements ("+ Commit money", "+ Add entry"),
//     and the SUBMIT buttons inside them are scoped to `.drawer-panel` because
//     "+ Add entry" would otherwise match a getByRole("button") lookup for
//     "Add entry" too.
// ============================================================================

const COMMITMENTS = "/demo/treasury/commitments";

async function seatAt(
  browser: Browser,
  who: { email: string; password: string },
  url: string,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who.email, who.password);
  await page.goto(url);
  return page;
}

// Raise a request through the real drawer, as whoever this page is signed in as.
async function raiseRequest(
  page: Page,
  fields: { vendor: string; purpose: string; amount: string },
): Promise<void> {
  await page.locator("summary", { hasText: "+ Commit money" }).first().click();
  const drawer = page.locator(".drawer-panel", { hasText: "Commit money to something" });
  await drawer.locator('input[name="vendor"]').fill(fields.vendor);
  await drawer.locator('input[name="purpose"]').fill(fields.purpose);
  await drawer.locator('input[name="amount"]').fill(fields.amount);
  // A commitment with no budget line cannot exist — it is the one required
  // select on any money form in this app.
  await drawer
    .locator('select[name="budget_line_id"]')
    .selectOption({ label: "Costume purchases" });
  await drawer.getByRole("button", { name: "Raise this request" }).click();
  await expect(page.locator(".alert-ok")).toContainText("Request raised");
}

// Open one commitment's panel by the vendor on it, and hand back the panel.
async function openPanel(page: Page, vendor: string) {
  await page.getByRole("link", { name: new RegExp(`— ${vendor}$`) }).click();
  const panel = page.locator(".table-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("commitments: request → approve → pay → close", () => {
  test.beforeAll(async () => {
    await ensureMembershipActive(DEMO.directorMembershipId, USERS.director.email);
    await ensureMembershipActive(DEMO.treasurerMembershipId, USERS.treasurer.email);
    await ensureMembershipActive(DEMO.boardMembershipId, USERS.board.email);
    await setDemoSpendingRules({});
    await resetDemoCommitments();
  });

  test.afterAll(async () => {
    await resetDemoCommitments();
    await setDemoSpendingRules({});
  });

  test("a director asks, the treasurer approves, pays and closes it", async ({
    browser,
  }) => {
    // ---- The director raises it ------------------------------------------
    const director = await seatAt(browser, USERS.director, COMMITMENTS);
    await expect(
      director.getByRole("heading", { name: "Commitments", exact: true }),
    ).toBeVisible();
    // $180 — under the shipped $250 second-approver amount, so this walk is the
    // ordinary one-approval path. The two-approval path is its own journey below.
    await raiseRequest(director, {
      vendor: "Riser Rental Co",
      purpose: "Risers for the spring show",
      amount: "180.00",
    });

    // It is committed from now, before any money has moved — which is the whole
    // reason the feature exists.
    await expect(director.locator(".metric-strip")).toContainText("$180.00");

    // THE REFUSAL, from the seat that raised it. Not an error after pressing a
    // button: the button is not offered, and the panel says why.
    const raised = await openPanel(director, "Riser Rental Co");
    await expect(raised).toContainText("You raised this request, so you cannot approve it");
    await expect(raised.getByRole("button", { name: "Approve it" })).toHaveCount(0);
    await expect(raised.getByRole("button", { name: "Add my approval" })).toHaveCount(0);

    // ---- The treasurer approves it ----------------------------------------
    const treasurer = await seatAt(browser, USERS.treasurer, COMMITMENTS);
    const toApprove = await openPanel(treasurer, "Riser Rental Co");
    await toApprove.getByRole("button", { name: "Approve it" }).click();
    await expect(treasurer.locator(".alert-ok")).toContainText("Approved.");

    // ---- …pays against it, from the commitment itself ----------------------
    // The link pre-fills the ledger drawer with this commitment, its line, its
    // vendor and what is still owed, so most payments never touch the drawdown
    // select at all (R3).
    const approved = await openPanel(treasurer, "Riser Rental Co");
    await approved.getByRole("link", { name: "Record a payment against this" }).click();
    await expect(treasurer).toHaveURL(/\/demo\/treasury\?commit=/);
    const entry = treasurer.locator(".drawer-panel", { hasText: "Pay " });
    await expect(entry.locator('input[name="amount"]')).toHaveValue("180.00");
    await entry.getByRole("button", { name: "Add entry", exact: true }).click();
    await expect(treasurer.locator(".alert-ok").first()).toBeVisible();

    // The drawdown, in the one sentence the panel exists to say.
    await treasurer.goto(COMMITMENTS);
    const paid = await openPanel(treasurer, "Riser Rental Co");
    await expect(paid).toContainText("paid $180.00");
    await expect(paid).toContainText("$0.00 still committed");

    // ---- …and closes it, releasing what is left ----------------------------
    // Two steps on purpose: the first press asks, with the amount and the line
    // in the sentence, because silently re-inflating an available balance is how
    // under-delivery gets hidden (R4).
    await paid.getByRole("link", { name: "Close it", exact: true }).click();
    const confirming = treasurer.locator(".table-panel");
    await expect(confirming).toContainText("Closing this releases");
    await confirming.locator('input[name="reason"]').first().fill("Delivered in full");
    await confirming
      .getByRole("button", { name: "Close it and release the rest" })
      .click();
    await expect(treasurer.locator(".alert-ok")).toContainText("Closed");

    // It leaves the open list and keeps what it released written on it.
    const closed = treasurer.locator(".table-panel");
    await expect(closed).toContainText("released back to");
    await director.context().close();
    await treasurer.context().close();
  });

  // The same refusal from the other direction: the TREASURER raises one, and the
  // seat that approves everything else in this app is refused this one.
  test("the seat that raised it cannot approve it, whichever seat that is", async ({
    browser,
  }) => {
    const treasurer = await seatAt(browser, USERS.treasurer, COMMITMENTS);
    await raiseRequest(treasurer, {
      vendor: "Sheet Music House",
      purpose: "Spring show arrangements",
      amount: "95.00",
    });

    const own = await openPanel(treasurer, "Sheet Music House");
    await expect(own).toContainText("You raised this request, so you cannot approve it");
    await expect(own.getByRole("button", { name: "Approve it" })).toHaveCount(0);

    // …and it really is only the approval that is withheld: she can still cancel
    // her own request, which is what a treasurer who raised one in error needs.
    await expect(own.locator("summary", { hasText: "Cancel it instead" })).toBeVisible();
    await treasurer.context().close();
  });

  // The second-approver amount (spec 006 D6). Over it, the treasurer's approval
  // is not enough on its own — and the app says so where the button used to be
  // rather than after the press.
  test("over the second-approver amount it takes two people", async ({ browser }) => {
    const director = await seatAt(browser, USERS.director, COMMITMENTS);
    // $2,000 — over the shipped $250, and over the $1,000 board amount too, which
    // is why nothing below issues it.
    await raiseRequest(director, {
      vendor: "Sound Stage Rentals",
      purpose: "Spring show audio",
      amount: "2,000.00",
    });

    // The treasurer is offered nothing yet, and is told why.
    const treasurer = await seatAt(browser, USERS.treasurer, COMMITMENTS);
    const waiting = await openPanel(treasurer, "Sound Stage Rentals");
    await expect(waiting).toContainText("needs two approvals");
    await expect(waiting.getByRole("button", { name: "Approve it" })).toHaveCount(0);

    // A board member — read-only everywhere else in this app — gives the first
    // approval. It does not approve the commitment; it is one of the two.
    const board = await seatAt(browser, USERS.board, COMMITMENTS);
    const first = await openPanel(board, "Sound Stage Rentals");
    await first.getByRole("button", { name: "Add my approval" }).click();
    await expect(board.locator(".alert-ok")).toContainText(
      "still a request until the treasurer approves it too",
    );

    // NOW the treasurer's approval finishes it.
    await treasurer.goto(COMMITMENTS);
    const second = await openPanel(treasurer, "Sound Stage Rentals");
    await expect(second).toContainText("Approved so far by");
    await second.getByRole("button", { name: "Approve it" }).click();
    await expect(treasurer.locator(".alert-ok")).toContainText("Approved.");

    // …and the board amount still stands between it and being issued.
    const approved = await openPanel(treasurer, "Sound Stage Rentals");
    await expect(approved).toContainText("cannot be issued until the board minutes");
    await expect(approved.getByRole("button", { name: "Mark as issued" })).toHaveCount(0);

    await director.context().close();
    await treasurer.context().close();
    await board.context().close();
  });
});
