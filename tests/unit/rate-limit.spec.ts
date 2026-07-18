// ============================================================================
// Unit tests — token-surface rate limiter (T021, §10).
// ----------------------------------------------------------------------------
// Pure/in-memory; deterministic via the injectable `now`. Guards the per-IP +
// per-token sliding window that protects the anonymous (public)/t/ routes.
// ============================================================================

import { describe, test, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  checkTokenSurfaceLimit,
  __resetRateLimit,
  TOKEN_LIMIT,
  IP_LIMIT,
  WINDOW_MS,
} from "@/lib/rate-limit";

beforeEach(() => __resetRateLimit());

describe("checkRateLimit sliding window", () => {
  test("allows up to the limit then blocks", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", 5, 1000, t0 + i).ok).toBe(true);
    }
    const blocked = checkRateLimit("k", 5, 1000, t0 + 5);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  test("recovers after the window slides past old hits", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i++) checkRateLimit("k", 5, 1000, t0 + i);
    expect(checkRateLimit("k", 5, 1000, t0 + 5).ok).toBe(false);
    // Advance beyond the window — the old hits age out.
    expect(checkRateLimit("k", 5, 1000, t0 + 1500).ok).toBe(true);
  });

  test("keys are independent", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i++) checkRateLimit("a", 5, 1000, t0);
    expect(checkRateLimit("a", 5, 1000, t0).ok).toBe(false);
    expect(checkRateLimit("b", 5, 1000, t0).ok).toBe(true);
  });
});

describe("checkTokenSurfaceLimit (per-IP + per-token)", () => {
  test("blocks when the token budget is exceeded", () => {
    const now = 5_000_000;
    let last = { ok: true } as { ok: boolean };
    for (let i = 0; i <= TOKEN_LIMIT; i++) {
      last = checkTokenSurfaceLimit({ ip: "1.1.1.1", tokenHash: "h", now });
    }
    expect(last.ok).toBe(false);
  });

  test("blocks when the IP budget is exceeded across different tokens", () => {
    const now = 6_000_000;
    let last = { ok: true } as { ok: boolean };
    for (let i = 0; i <= IP_LIMIT; i++) {
      // Distinct token each hit so only the IP budget accumulates.
      last = checkTokenSurfaceLimit({ ip: "2.2.2.2", tokenHash: `h${i}`, now });
    }
    expect(last.ok).toBe(false);
  });

  test("a null IP still enforces the per-token budget", () => {
    const now = 7_000_000;
    let last = { ok: true } as { ok: boolean };
    for (let i = 0; i <= TOKEN_LIMIT; i++) {
      last = checkTokenSurfaceLimit({ ip: null, tokenHash: "solo", now });
    }
    expect(last.ok).toBe(false);
  });

  test("window constant is one minute", () => {
    expect(WINDOW_MS).toBe(60_000);
  });
});
