// Constitution VIII — Build Complete, Release by Flag.
// A typed flag registry gates *exposure*, not construction. Evaluated
// server-side only (this module carries no 'use client'): navigation hides,
// routes 404 server-side, and Inngest jobs no-op. No client-side-only gating,
// no third-party flag service — a jsonb column plus this registry is the whole
// system. Per-program overrides live in `programs.feature_overrides`.

export type FlagKey =
  | "costumes"
  | "competitions"
  | "packet_parse"
  | "travel"
  | "treasury"
  | "comms"
  | "digest"
  | "announcements"
  | "shifts"
  | "events"
  | "archive"
  | "support_access";

interface FlagDefinition {
  description: string;
  default: boolean;
}

export const flagRegistry: Record<FlagKey, FlagDefinition> = {
  costumes: {
    description: "Costume inventory, assignments, alterations, and checkout.",
    default: true,
  },
  competitions: {
    description: "Competitions, attendance, results, and itineraries.",
    default: true,
  },
  packet_parse: {
    description: "AI host-packet parsing into draft itineraries.",
    default: false,
  },
  travel: {
    description: "Trips, rooms, buses, and chaperone rosters.",
    default: true,
  },
  treasury: {
    description: "Budget builder, ledger, and budget-vs-actual.",
    default: true,
  },
  comms: {
    description: "Communications surface (announcements, digest, shifts).",
    default: true,
  },
  digest: {
    description: "Weekly AI digest draft, review, and send pipeline.",
    default: false,
  },
  announcements: {
    description: "Immediate announcement sends to guardians.",
    default: true,
  },
  shifts: {
    description: "Volunteer shifts and tokenized signup.",
    default: true,
  },
  events: {
    description: "General events (rehearsals, fittings, banquets).",
    default: true,
  },
  archive: {
    description: "Season archive, rollover, and trophy case.",
    default: true,
  },
  support_access: {
    description: "Read-only support impersonation view.",
    default: false,
  },
};

// ---------------------------------------------------------------------------
// Tier → flag bundles (FR-008 / arch §12)
// ---------------------------------------------------------------------------
// A program's tier sets its baseline feature surface. Bundles are PARTIAL: a key
// a bundle omits falls through to the registry default (so adding a new flag
// never requires touching every tier). Per-program feature_overrides always win
// over the tier baseline — a director can turn a single feature on/off
// regardless of tier.
//
// Rationale (documented deliberately — this is a product decision, not a config
// accident):
//   • prep    — the entry tier: core season operations only. The AI surfaces
//               (packet_parse, digest) and the money surface (treasury) are
//               TRIMMED off; costumes, competitions, travel, comms, announcements,
//               shifts, events, and the archive stay on. A prep program runs a
//               season without ever seeing an AI draft or a ledger.
//   • varsity — the standard tier: MOST features on. Everything prep has, plus
//               treasury and the AI surfaces (packet_parse + digest) enabled.
//   • program — the top tier: ALL product features on (same as varsity today,
//               named separately so future program-only features slot in here).
//
// NOTE: `support_access` is intentionally NOT set by any tier. Support
// impersonation is governed by director consent + profiles.is_support (§10),
// never by a program's tier — so it stays at its registry default (off) unless a
// per-program override flips it. Tier bundles decide PRODUCT surface, not the
// cross-tenant support path.

export type ProgramTier = "prep" | "varsity" | "program";

export const TIER_BUNDLES: Record<ProgramTier, Partial<Record<FlagKey, boolean>>> = {
  prep: {
    // Core ops on (registry defaults already true); AI + treasury trimmed off.
    packet_parse: false,
    digest: false,
    treasury: false,
  },
  varsity: {
    // Most on: enable the AI surfaces (default-off in the registry) + treasury.
    treasury: true,
    packet_parse: true,
    digest: true,
  },
  program: {
    // All product features on.
    treasury: true,
    packet_parse: true,
    digest: true,
  },
};

export interface FlaggableProgram {
  feature_overrides: Record<string, boolean> | null;
  tier: ProgramTier;
}

// Resolution order (arch §12): a per-program override wins; otherwise the
// program's tier bundle; otherwise the registry default. `?? ` chains correctly
// because every layer stores real booleans (never undefined-as-false).
export function flag(program: FlaggableProgram, key: FlagKey): boolean {
  const override = program.feature_overrides?.[key];
  return override ?? TIER_BUNDLES[program.tier]?.[key] ?? flagRegistry[key].default;
}
