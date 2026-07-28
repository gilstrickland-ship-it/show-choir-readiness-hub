import { test, expect } from "@playwright/test";
import {
  signIn,
  USERS,
  DEMO,
  readState,
  adminClient,
  ensureMembershipActive,
  resetDemoParentState,
  mintShareToken,
  revokeAllDemoShareLinks,
  setDemoFeatureOverrides,
  resetDemoFeatureOverrides,
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

// F-A — the broadcast link a director pastes into a booster post opens the TIMES
// and only the times.
//
// Publishing an itinerary auto-mints a share link and tells the director they
// shared the schedule. The packet route accepted that same `resource='itinerary'`
// token and served the parent packet PDF — bus and hotel-ROOM assignments listing
// students by name, plus chaperone and volunteer names. Revert the narrowing in
// app/(public)/t/[token]/packet/route.ts and the first assertion below goes from
// 404 to a 200 application/pdf, which is the whole finding.
test.describe("an itinerary share link cannot fetch the parent packet (F-A)", () => {
  let shareToken = "";

  test.beforeAll(async () => {
    shareToken = await mintShareToken({
      resource: "itinerary",
      resourceId: DEMO.competitionId,
    });
  });

  test.afterAll(async () => {
    await revokeAllDemoShareLinks();
  });

  test("the packet refuses it; the times it was promised still work", async ({
    page,
  }) => {
    const share = `/t/${shareToken}`;

    // --- THE REFUSAL: no rooming list off a link made to be posted publicly ---
    const withQuery = await page.request.get(
      `${share}/packet?competition=${DEMO.competitionId}`,
    );
    expect(withQuery.status()).toBe(404);
    expect(withQuery.headers()["content-type"]).not.toContain("application/pdf");

    // The old route took the competition from the LINK's own resource_id, so the
    // query-less form is the exact shape that used to work. It must 404 too —
    // not fall through to the guardian branch's 400 "Missing ?competition=".
    const bare = await page.request.get(`${share}/packet`);
    expect(bare.status()).toBe(404);
    expect(bare.headers()["content-type"]).not.toContain("application/pdf");

    // --- The link still does what the director was told it does --------------
    await page.goto(`${share}/itinerary`);
    await expect(
      page.getByRole("heading", { name: /Central Illinois Invitational/ }),
    ).toBeVisible();
    await expect(page.getByText("Bus departs")).toBeVisible();

    // …and nothing on that page offers the packet. exact: true — "Download
    // packet (PDF)" is a substring-matchable name and a count assertion that
    // matched the wrong node would prove nothing.
    await expect(
      page.getByRole("link", { name: "Download packet (PDF)", exact: true }),
    ).toHaveCount(0);

    // The .ics beside it is the same published times, so it is still shareable.
    const ics = await page.request.get(
      `${share}/itinerary/ics/${DEMO.competitionId}`,
    );
    expect(ics.status()).toBe(200);
    expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  });
});

// F-B — Constitution VIII on the surface that evaluated no flags at all. A
// feature that is off must be genuinely unreachable, not merely unlinked: with
// `shifts` off, families were still claiming volunteer slots that no staff
// surface could show or manage.
//
// The overrides are set for this file only and cleared in afterAll — every other
// spec in this single-worker suite shares the Demo tenant.
test.describe("a flag-off parent surface refuses (F-B, Constitution VIII)", () => {
  test.afterAll(async () => {
    await resetDemoFeatureOverrides();
  });

  test("shifts off: no signup page, no volunteer nudge, no footer link", async ({
    page,
  }) => {
    const base = `/t/${readState().guardianRawToken}`;
    await setDemoFeatureOverrides({ shifts: false });

    await page.goto(`${base}/signup`);
    // A VALID family link gets a sentence, not a hard 404 — and the sentence
    // names no feature, so it discloses nothing about any program's setup.
    await expect(
      page.getByRole("heading", { name: "Not available" }),
    ).toBeVisible();
    // The form is gone with the page: no shift card, so nothing to post.
    await expect(page.getByRole("button", { name: "Sign up" })).toHaveCount(0);
    await expect(page.locator(".confirm-box")).toHaveCount(0);

    // The family home stops nudging toward it, and the footer stops linking it.
    await page.goto(base);
    await expect(page.locator(".token-nudge")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Volunteer signup →", exact: true }),
    ).toHaveCount(0);
    // The other footer links are untouched — one flag off is not the whole
    // surface off.
    await expect(
      page.getByRole("link", { name: "Itinerary →", exact: true }),
    ).toBeVisible();
  });

  test("competitions off: the itinerary, the packet and the .ics all refuse", async ({
    page,
  }) => {
    const base = `/t/${readState().guardianRawToken}`;
    await setDemoFeatureOverrides({ competitions: false });

    await page.goto(`${base}/itinerary`);
    await expect(
      page.getByRole("heading", { name: "Not available" }),
    ).toBeVisible();
    await expect(page.getByText("Bus departs")).toHaveCount(0);

    // The file routes have no page to render, so they say the same sentence as
    // a plain 404 body — and serve no document.
    const packet = await page.request.get(
      `${base}/packet?competition=${DEMO.competitionId}`,
    );
    expect(packet.status()).toBe(404);
    expect(packet.headers()["content-type"]).not.toContain("application/pdf");

    const ics = await page.request.get(
      `${base}/itinerary/ics/${DEMO.competitionId}`,
    );
    expect(ics.status()).toBe(404);
    expect(await ics.text()).not.toContain("BEGIN:VCALENDAR");

    // Absence reporting hangs off the same staff queue, so it closes too.
    await page.goto(`${base}/absence`);
    await expect(
      page.getByRole("heading", { name: "Not available" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit absence report" }),
    ).toHaveCount(0);
  });

  test("every flag off: unsubscribe still works (CAN-SPAM / RFC 8058)", async ({
    page,
  }) => {
    const base = `/t/${readState().guardianRawToken}`;
    await setDemoFeatureOverrides({
      costumes: false,
      competitions: false,
      travel: false,
      treasury: false,
      comms: false,
      digest: false,
      announcements: false,
      shifts: false,
      events: false,
      archive: false,
      guide: false,
    });

    await page.goto(`${base}/unsubscribe`);
    // The one parent surface that is never gated: a program that turns comms off
    // must still honour the footer link in the mail it already sent.
    await expect(
      page.getByRole("heading", { name: "Unsubscribe", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unsubscribe this address" }),
    ).toBeVisible();

    // The family home still resolves — it is their page — but it has degraded to
    // their students' names, with no costume rows and no competition hero.
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Ava Bennett" }),
    ).toBeVisible();
    await expect(page.locator(".token-hero")).toHaveCount(0);
    await expect(page.locator(".token-costume-row")).toHaveCount(0);
    await expect(page.locator(".token-welcome-card")).toHaveCount(0);
  });
});
