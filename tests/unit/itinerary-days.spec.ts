// ============================================================================
// Unit tests — living-itinerary change detection (T055, C2-2; reworked T169).
// ----------------------------------------------------------------------------
// Pure; no DB, no React (runs under vitest.unit.config.ts). Two rules, and the
// split between them is the whole point of T169:
//
//   changedSincePublish   — DOES the banner exist? Read from the itinerary row's
//                           `items_changed_at`, which migration 0024's trigger
//                           stamps on insert, update AND delete. It therefore
//                           sees a line that was REMOVED from a published
//                           schedule, which the surviving item rows never can.
//   editedItemsSincePublish — how many items that are still there were touched.
//                           Staff detail only. This number used to BE the
//                           banner's condition, and a deletion left it at zero.
//
// Both honour the same grace window: a change counts only when it happened MORE
// than PUBLISH_JITTER_MS after published_at, so the publish write itself (and
// last-second tidies) never trip the banner.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  changedSincePublish,
  editedItemsSincePublish,
  itineraryAnchors,
  PUBLISH_JITTER_MS,
} from "@/lib/itinerary-days";

const PUBLISHED_AT = "2026-04-10T12:00:00.000Z";
const base = new Date(PUBLISHED_AT).getTime();
const threshold = base + PUBLISH_JITTER_MS;
const iso = (ms: number) => new Date(ms).toISOString();
const UNCHANGED = { changed: false, changedAt: null };

describe("changedSincePublish", () => {
  test("no published_at → nothing changed (a draft has no banner)", () => {
    expect(changedSincePublish(iso(threshold + 5_000), null)).toEqual(UNCHANGED);
  });

  test("no items_changed_at → nothing changed", () => {
    expect(changedSincePublish(null, PUBLISHED_AT)).toEqual(UNCHANGED);
  });

  test("a stamp exactly at the jitter threshold does NOT count (strict >)", () => {
    expect(changedSincePublish(iso(threshold), PUBLISHED_AT)).toEqual(UNCHANGED);
  });

  test("a stamp one ms past the threshold counts, and is what the banner prints", () => {
    const at = iso(threshold + 1);
    expect(changedSincePublish(at, PUBLISHED_AT)).toEqual({
      changed: true,
      changedAt: at,
    });
  });

  test("a stamp inside the jitter window (incl. the publish moment) is ignored", () => {
    expect(changedSincePublish(PUBLISHED_AT, PUBLISHED_AT)).toEqual(UNCHANGED);
    expect(changedSincePublish(iso(base + 30_000), PUBLISHED_AT)).toEqual(
      UNCHANGED,
    );
  });

  test("a stamp BEFORE publishing is not a change since publishing", () => {
    expect(changedSincePublish(iso(base - 3_600_000), PUBLISHED_AT)).toEqual(
      UNCHANGED,
    );
  });

  // THE DEFECT T169 CLOSES, at the level of the pure rule: the banner's
  // existence is decided without consulting a single item row, so a schedule
  // whose only post-publish change was a DELETION still raises it.
  test("a change with no surviving edited items still raises the banner", () => {
    const at = iso(threshold + 60_000);
    const survivors = [{ updated_at: iso(base - 60_000) }]; // untouched since
    expect(changedSincePublish(at, PUBLISHED_AT)).toEqual({
      changed: true,
      changedAt: at,
    });
    expect(editedItemsSincePublish(survivors, PUBLISHED_AT)).toBe(0);
  });

  test("malformed timestamps → nothing changed (no throw)", () => {
    expect(changedSincePublish(iso(threshold + 5_000), "not-a-date")).toEqual(
      UNCHANGED,
    );
    expect(changedSincePublish("not-a-date", PUBLISHED_AT)).toEqual(UNCHANGED);
  });

  test("a custom jitter window is honoured", () => {
    const at = iso(base + 5_000);
    // 5s after publish is inside a 10s window (ignored)…
    expect(changedSincePublish(at, PUBLISHED_AT, 10_000)).toEqual(UNCHANGED);
    // …but outside a 1s window (counts).
    expect(changedSincePublish(at, PUBLISHED_AT, 1_000)).toEqual({
      changed: true,
      changedAt: at,
    });
  });
});

describe("editedItemsSincePublish", () => {
  test("no published_at → zero", () => {
    expect(editedItemsSincePublish([{ updated_at: iso(threshold + 1) }], null)).toBe(0);
  });

  test("no items → zero", () => {
    expect(editedItemsSincePublish([], PUBLISHED_AT)).toBe(0);
  });

  test("an edit exactly at the jitter threshold does NOT count (strict >)", () => {
    expect(editedItemsSincePublish([{ updated_at: iso(threshold) }], PUBLISHED_AT)).toBe(0);
  });

  test("counts every genuine post-publish edit", () => {
    const items = [
      { updated_at: PUBLISHED_AT }, // the publish write itself → ignored
      { updated_at: iso(base + 30_000) }, // last-second tidy → ignored
      { updated_at: iso(threshold + 10_000) }, // counts
      { updated_at: null }, // never edited → ignored
      { updated_at: iso(threshold + 90_000) }, // counts
    ];
    expect(editedItemsSincePublish(items, PUBLISHED_AT)).toBe(2);
  });

  test("malformed published_at → zero (no throw)", () => {
    expect(
      editedItemsSincePublish([{ updated_at: iso(threshold + 1) }], "not-a-date"),
    ).toBe(0);
  });

  test("a custom jitter window is honoured", () => {
    const items = [{ updated_at: iso(base + 5_000) }];
    expect(editedItemsSincePublish(items, PUBLISHED_AT, 10_000)).toBe(0);
    expect(editedItemsSincePublish(items, PUBLISHED_AT, 1_000)).toBe(1);
  });
});

// ============================================================================
// Parent-poster time anchors (§8a, §10). "home ~X" must only show with a real
// end anchor — otherwise it either has no basis or just mirrors the call time,
// which reads as misinformation on the family page.
// ============================================================================

describe("itineraryAnchors", () => {
  const t = (s: string) => `2026-04-10T${s}:00-00:00`;

  test("call time prefers the depart item's start", () => {
    const { callTime } = itineraryAnchors([
      { starts_at: t("09:00"), ends_at: null, kind: "arrive" },
      { starts_at: t("07:00"), ends_at: null, kind: "depart" },
    ]);
    expect(callTime).toBe(t("07:00"));
  });

  test("falls back to the earliest start when there's no depart item", () => {
    const { callTime } = itineraryAnchors([
      { starts_at: t("08:00"), ends_at: null, kind: "warmup" },
      { starts_at: t("10:00"), ends_at: null, kind: "perform" },
    ]);
    expect(callTime).toBe(t("08:00"));
  });

  test("home estimate is the latest genuine end time", () => {
    const { homeEstimate } = itineraryAnchors([
      { starts_at: t("07:00"), ends_at: t("08:00"), kind: "depart" },
      { starts_at: t("10:00"), ends_at: t("21:30"), kind: "return" },
    ]);
    expect(homeEstimate).toBe(t("21:30"));
  });

  test("no item has an end time → no home estimate (suppressed)", () => {
    const { homeEstimate } = itineraryAnchors([
      { starts_at: t("07:00"), ends_at: null, kind: "depart" },
      { starts_at: t("10:00"), ends_at: null, kind: "perform" },
    ]);
    expect(homeEstimate).toBeNull();
  });

  test("end anchor collapsing to the call time → suppressed (no misleading echo)", () => {
    const { callTime, homeEstimate } = itineraryAnchors([
      { starts_at: t("07:00"), ends_at: t("07:00"), kind: "depart" },
    ]);
    expect(callTime).toBe(t("07:00"));
    expect(homeEstimate).toBeNull();
  });

  test("empty itinerary → both null", () => {
    expect(itineraryAnchors([])).toEqual({ callTime: null, homeEstimate: null });
  });
});
