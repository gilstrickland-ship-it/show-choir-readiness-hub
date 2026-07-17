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

export interface FlaggableProgram {
  feature_overrides: Record<string, boolean> | null;
}

export function flag(program: FlaggableProgram, key: FlagKey): boolean {
  const override = program.feature_overrides?.[key];
  return override ?? flagRegistry[key].default;
}
