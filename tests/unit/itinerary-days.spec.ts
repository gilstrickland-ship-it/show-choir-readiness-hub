// ============================================================================
// Unit tests — living-itinerary change detection (T055, C2-2).
// ----------------------------------------------------------------------------
// Pure; no DB, no React (runs under vitest.unit.config.ts). Locks the rule the
// staff editor's post-publish nudge AND the parent page's "Updated {when}"
// banner both read: an item counts as changed-since-publish only when it was
// edited MORE than PUBLISH_JITTER_MS after published_at, so the publish write
// itself (and last-second tidies) never trip the banner.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  changedItemsSincePublish,
  PUBLISH_JITTER_MS,
} from "@/lib/itinerary-days";

const PUBLISHED_AT = "2026-04-10T12:00:00.000Z";
const base = new Date(PUBLISHED_AT).getTime();
const threshold = base + PUBLISH_JITTER_MS;
const iso = (ms: number) => new Date(ms).toISOString();

describe("changedItemsSincePublish", () => {
  test("no published_at → nothing changed", () => {
    const items = [{ updated_at: iso(threshold + 5_000) }];
    expect(changedItemsSincePublish(items, null)).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("no items → nothing changed", () => {
    expect(changedItemsSincePublish([], PUBLISHED_AT)).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("edit exactly at the jitter threshold does NOT count (strict >)", () => {
    const items = [{ updated_at: iso(threshold) }];
    expect(changedItemsSincePublish(items, PUBLISHED_AT)).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("edit one ms past the threshold counts", () => {
    const at = iso(threshold + 1);
    expect(changedItemsSincePublish([{ updated_at: at }], PUBLISHED_AT)).toEqual(
      { count: 1, lastChangedAt: at },
    );
  });

  test("edits within the jitter window (incl. exactly at publish) are ignored", () => {
    const items = [
      { updated_at: PUBLISHED_AT }, // the publish write itself
      { updated_at: iso(base + 30_000) }, // last-second tidy, inside window
      { updated_at: iso(threshold) }, // exactly at edge
    ];
    expect(changedItemsSincePublish(items, PUBLISHED_AT)).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("counts every genuine post-publish edit and reports the latest", () => {
    const early = iso(threshold + 10_000);
    const late = iso(threshold + 90_000);
    const items = [
      { updated_at: PUBLISHED_AT }, // ignored (publish write)
      { updated_at: early }, // counts
      { updated_at: null }, // never edited → ignored
      { updated_at: late }, // counts, and is the latest
    ];
    expect(changedItemsSincePublish(items, PUBLISHED_AT)).toEqual({
      count: 2,
      lastChangedAt: late,
    });
  });

  test("items with null updated_at are ignored", () => {
    const items = [{ updated_at: null }, { updated_at: null }];
    expect(changedItemsSincePublish(items, PUBLISHED_AT)).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("malformed published_at → nothing changed (no throw)", () => {
    const items = [{ updated_at: iso(threshold + 5_000) }];
    expect(changedItemsSincePublish(items, "not-a-date")).toEqual({
      count: 0,
      lastChangedAt: null,
    });
  });

  test("a custom jitter window is honoured", () => {
    const at = iso(base + 5_000);
    // 5s edit is inside a 10s window (ignored)…
    expect(
      changedItemsSincePublish([{ updated_at: at }], PUBLISHED_AT, 10_000),
    ).toEqual({ count: 0, lastChangedAt: null });
    // …but outside a 1s window (counts).
    expect(
      changedItemsSincePublish([{ updated_at: at }], PUBLISHED_AT, 1_000),
    ).toEqual({ count: 1, lastChangedAt: at });
  });
});
