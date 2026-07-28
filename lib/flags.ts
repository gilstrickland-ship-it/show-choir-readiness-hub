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
  | "hosting"
  | "guide";

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
  // NOTE: there is deliberately no `support_access` flag. There was one, and
  // nothing ever evaluated it — the real gate on support impersonation is
  // `programs.support_access_until` (time-boxed director consent, set and
  // cleared from Settings) AND `profiles.is_support`, enforced in the DB by
  // 0004's SECURITY DEFINER policies and in the app by lib/support.ts. A flag
  // beside them could only ever be a second, weaker answer to a question the
  // schema already answers, so it is gone rather than wired up (spec 005 T143).
  hosting: {
    description:
      "Host-mode: run your own invitational — visiting schools, homerooms, schedule, packets.",
    default: false,
  },
  guide: {
    description:
      "First-use guidance: role journeys, screen intros, parent welcome card.",
    default: true,
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
// Tier bundles decide PRODUCT surface, and only that. Support impersonation is
// governed by director consent (`programs.support_access_until`) plus
// `profiles.is_support` (§10) — a tenant-isolation boundary, not a feature a
// tier buys, which is why it has no flag at all (see the registry note above).
//
// NOTE: `hosting` (Wave I host-mode) is NOT in any tier bundle. Running your own
// invitational is a pilot capability enabled per-program via feature_overrides,
// not a tier entitlement yet, so it stays at its registry default (off) until a
// per-program override turns it on. This is a deliberate product decision,
// recorded in specs/002-roadmap-wave-2 I1.

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
