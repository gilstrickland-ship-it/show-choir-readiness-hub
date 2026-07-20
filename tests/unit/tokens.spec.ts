// ============================================================================
// Unit tests — tokenized link layer primitives (T021, §8a).
// ----------------------------------------------------------------------------
// Pure parts only; no DB, no network (runs under vitest.unit.config.ts). Covers
// mint/hash/verify and the capability allow-list SHAPE — the allow-list is the
// security boundary for the anonymous token surface, so its exact contents are
// asserted here to catch accidental capability creep (Constitution II).
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  generateToken,
  hashToken,
  verifyToken,
  guardianLinks,
  guardianCan,
  shareCan,
  CAPABILITIES,
  GUARDIAN_CAPABILITIES,
  SHARE_CAPABILITIES,
  GUARDIAN_WRITE_CAPABILITIES,
} from "@/lib/tokens";

describe("mint / hash", () => {
  test("generateToken yields a URL-safe raw token and its sha256-hex hash", () => {
    const { raw, hash } = generateToken();
    // base64url: no +, /, or = padding.
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes → 43 base64url chars.
    expect(raw.length).toBeGreaterThanOrEqual(43);
    // sha256 hex is 64 chars.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(raw));
  });

  test("tokens are unique across mints (≥128-bit random)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateToken().raw);
    expect(seen.size).toBe(200);
  });

  test("hashToken is deterministic", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
    expect(hashToken("hello")).not.toBe(hashToken("world"));
  });
});

describe("verify (constant-time)", () => {
  test("accepts a raw token against its own hash", () => {
    const { raw, hash } = generateToken();
    expect(verifyToken(raw, hash)).toBe(true);
  });

  test("rejects a wrong token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(verifyToken(a.raw, b.hash)).toBe(false);
  });

  test("rejects when lengths differ (no throw)", () => {
    expect(verifyToken("x", "abcd")).toBe(false);
  });
});

describe("capability allow-list (exhaustive — §8a)", () => {
  test("guardian capabilities are EXACTLY the documented set", () => {
    // email:unsubscribe is a deliberate, justified addition (CAN-SPAM + RFC 8058
    // one-click): a preference write on the recipient's own address, added to the
    // allow-list so the token unsubscribe surfaces are gated by it. The list
    // stays tiny — this test guards against any further creep.
    expect([...GUARDIAN_CAPABILITIES].sort()).toEqual(
      [
        "absence:submit",
        "costume:view",
        "email:unsubscribe",
        "itinerary:view",
        "shift:cancel",
        "shift:claim",
        "signup:view",
      ].sort(),
    );
  });

  test("guardian WRITES are exactly the three operational writes", () => {
    // Unsubscribe is a PREFERENCE write, not an operational one — it stays OUT of
    // this set (which gates the shift/absence writes that touch operations).
    expect([...GUARDIAN_WRITE_CAPABILITIES].sort()).toEqual(
      ["absence:submit", "shift:cancel", "shift:claim"].sort(),
    );
  });

  test("share links allow ONLY read-only resource view", () => {
    expect([...SHARE_CAPABILITIES]).toEqual(["resource:view"]);
  });

  test("CAPABILITIES groups the two kinds", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(["guardian", "share"]);
  });

  test("guardianCan / shareCan gate correctly", () => {
    expect(guardianCan("shift:claim")).toBe(true);
    expect(guardianCan("resource:view")).toBe(false);
    expect(guardianCan("ledger:write")).toBe(false);
    expect(shareCan("resource:view")).toBe(true);
    expect(shareCan("shift:claim")).toBe(false);
  });
});

describe("guardianLinks (three canonical footer URLs)", () => {
  test("builds itinerary / signup / absence / unsubscribe links off the raw token", () => {
    const links = guardianLinks("RAWTOKEN");
    expect(links.itinerary).toMatch(/\/t\/RAWTOKEN\/itinerary$/);
    expect(links.signup).toMatch(/\/t\/RAWTOKEN\/signup$/);
    expect(links.absence).toMatch(/\/t\/RAWTOKEN\/absence$/);
    expect(links.unsubscribe).toMatch(/\/t\/RAWTOKEN\/unsubscribe$/);
  });
});
