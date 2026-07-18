// ============================================================================
// Unit tests — tier → flag-bundle resolution (T034, FR-008 / arch §12).
// ----------------------------------------------------------------------------
// Pure resolution logic (no DB): override ?? tier-bundle ?? registry default.
// The bundles are a product decision, so the exact per-tier surface is pinned
// here to catch accidental drift.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  flag,
  flagRegistry,
  TIER_BUNDLES,
  type FlagKey,
  type ProgramTier,
  type FlaggableProgram,
} from "@/lib/flags";

function prog(
  tier: ProgramTier,
  overrides: Record<string, boolean> | null = null,
): FlaggableProgram {
  return { tier, feature_overrides: overrides };
}

describe("registry default fallthrough", () => {
  test("a key no tier bundle sets falls through to the registry default", () => {
    // `costumes` defaults true and is set by no bundle → true for every tier.
    for (const tier of ["prep", "varsity", "program"] as ProgramTier[]) {
      expect(TIER_BUNDLES[tier].costumes).toBeUndefined();
      expect(flag(prog(tier), "costumes")).toBe(flagRegistry.costumes.default);
      expect(flag(prog(tier), "costumes")).toBe(true);
    }
  });
});

describe("prep tier — core ops on, AI + treasury trimmed", () => {
  test("core operational features stay on", () => {
    for (const key of [
      "costumes",
      "competitions",
      "travel",
      "comms",
      "announcements",
      "shifts",
      "events",
      "archive",
    ] as FlagKey[]) {
      expect(flag(prog("prep"), key)).toBe(true);
    }
  });

  test("AI surfaces and treasury are trimmed off", () => {
    expect(flag(prog("prep"), "packet_parse")).toBe(false);
    expect(flag(prog("prep"), "digest")).toBe(false);
    expect(flag(prog("prep"), "treasury")).toBe(false);
  });
});

describe("varsity tier — most on", () => {
  test("enables the AI surfaces (default-off in the registry) and treasury", () => {
    expect(flagRegistry.packet_parse.default).toBe(false);
    expect(flagRegistry.digest.default).toBe(false);
    expect(flag(prog("varsity"), "packet_parse")).toBe(true);
    expect(flag(prog("varsity"), "digest")).toBe(true);
    expect(flag(prog("varsity"), "treasury")).toBe(true);
  });
});

describe("program tier — all product features on", () => {
  test("every product flag resolves on", () => {
    const productKeys = (Object.keys(flagRegistry) as FlagKey[]).filter(
      (k) => k !== "support_access",
    );
    for (const key of productKeys) {
      expect(flag(prog("program"), key)).toBe(true);
    }
  });
});

describe("support_access is never tier-driven", () => {
  test("stays at its registry default (off) for every tier", () => {
    for (const tier of ["prep", "varsity", "program"] as ProgramTier[]) {
      expect(TIER_BUNDLES[tier].support_access).toBeUndefined();
      expect(flag(prog(tier), "support_access")).toBe(false);
    }
  });

  test("a per-program override can still turn it on", () => {
    expect(flag(prog("prep", { support_access: true }), "support_access")).toBe(true);
  });
});

describe("per-program override wins over the tier bundle", () => {
  test("override turns a tier-trimmed feature back ON (prep + treasury override)", () => {
    expect(flag(prog("prep"), "treasury")).toBe(false);
    expect(flag(prog("prep", { treasury: true }), "treasury")).toBe(true);
  });

  test("override turns a tier-enabled feature OFF (varsity + digest override)", () => {
    expect(flag(prog("varsity"), "digest")).toBe(true);
    expect(flag(prog("varsity", { digest: false }), "digest")).toBe(false);
  });

  test("a false override is honored, not treated as absent", () => {
    // costumes defaults true; an explicit false must win (?? not ||).
    expect(flag(prog("program", { costumes: false }), "costumes")).toBe(false);
  });
});
