import { test, expect } from "@playwright/test";
import {
  signIn,
  USERS,
  DEMO,
  readState,
  adminClient,
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
    // The packet names students against hotel rooms, and a PDF is a first-class
    // indexable document with no <head> for the layout's robots <meta> to ride
    // in. The directive has to be a HEADER on this response (lib/no-index).
    expect(packet.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");

    // And on the route's refusals too — a 400 from the text() helper is served
    // from the same URL space, so it must not be indexable either.
    const packetNoComp = await page.request.get(`${base}/packet`);
    expect(packetNoComp.status()).toBe(400);
    expect(packetNoComp.headers()["x-robots-tag"]).toBe(
      "noindex, nofollow, noarchive",
    );

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

// Invariant §9.3 — publish gates parent visibility. The staff editor keeps a
// published itinerary editable in place (the living-itinerary contract), so
// "unpublished" has to be re-proved from the PARENT side, server-side, on every
// surface that can reach a schedule: not merely unlinked, but unreachable by
// typing the URL. Every one of the five is checked with the itinerary flipped to
// draft, then it is restored — later spec files in this single-worker suite read
// the same seeded competition.
test.describe("unpublished itinerary is invisible through the token surface (§9.3)", () => {
  const setStatus = async (status: "draft" | "published") => {
    const admin = adminClient();
    const { error } = await admin
      .from("itineraries")
      .update({
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .eq("program_id", DEMO.programId)
      .eq("competition_id", DEMO.competitionId);
    if (error) throw new Error(`itinerary ${status} failed: ${error.message}`);
  };

  test.beforeAll(async () => {
    await setStatus("draft");
  });

  test.afterAll(async () => {
    await setStatus("published");
  });

  test("draft itinerary: no times, no packet, no calendar file", async ({
    page,
  }) => {
    const token = readState().guardianRawToken;
    const base = `/t/${token}`;

    // --- Poster: the hero says so, and offers neither document --------------
    await page.goto(base);
    await expect(page.getByText("Itinerary not published yet.")).toBeVisible();
    // exact: true — "View the itinerary" would otherwise also be matched by the
    // footer's "Itinerary →" under getByRole's substring semantics, and a
    // count assertion that matches the wrong node proves nothing.
    await expect(
      page.getByRole("link", { name: "View the itinerary", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Download packet (PDF)", exact: true }),
    ).toHaveCount(0);
    // No call time leaks into the hero meta line either.
    await expect(page.locator(".token-hero-meta")).not.toContainText("call");

    // --- Itinerary page: empty state, no schedule rows ----------------------
    await page.goto(`${base}/itinerary`);
    await expect(page.getByText("No published itineraries yet")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Central Illinois Invitational/ }),
    ).toHaveCount(0);
    // "Bus departs" is the seeded 6:30am depart item — the single fact that
    // proves no draft row reached the page.
    await expect(page.getByText("Bus departs")).toHaveCount(0);
    await expect(page.locator(".itinerary-links")).toHaveCount(0);

    // --- The routes refuse directly, not just when unlinked -----------------
    const packet = await page.request.get(
      `${base}/packet?competition=${DEMO.competitionId}`,
    );
    expect(packet.status()).toBe(409);
    expect(packet.headers()["content-type"]).not.toContain("application/pdf");

    const ics = await page.request.get(
      `${base}/itinerary/ics/${DEMO.competitionId}`,
    );
    expect(ics.status()).toBe(404);
    expect(await ics.text()).not.toContain("BEGIN:VCALENDAR");
  });
});
