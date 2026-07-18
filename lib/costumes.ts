import type { Role } from "@/lib/auth";

// Shared constants + helpers for the costume surface (T009–T011). Not a
// 'use server' module — imported by both server components and server actions.
//
// Writes are director/admin/costume_manager per the §2 permission matrix
// ("Costumes CRUD" ✅ for costume_manager). Reads add board_member — that's
// COSTUMES_ROLES in lib/nav.ts, which every costume page gates on. Every write
// action re-checks COSTUME_WRITE_ROLES via requireRole (Constitution I,
// defense in depth) even though RLS also gates it.

export const COSTUME_WRITE_ROLES: readonly Role[] = [
  "director",
  "admin",
  "costume_manager",
];

// Free-text fields carry the standing no-health label (Constitution III).
export const NO_HEALTH_LABEL = "Do not enter health or medical information.";

// ---------------------------------------------------------------------------
// Piece kinds / conditions / alteration statuses (mirror the 0001 enums exactly)
// ---------------------------------------------------------------------------

export const PIECE_KINDS = [
  "dress",
  "vest",
  "pants",
  "shoes",
  "accessory",
  "prop",
  "set_piece",
] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

// Props and set pieces ride the same inventory + checkout rails but skip student
// assignment (§4) — they flow through checkout via a direct piece_id row.
export const DIRECT_KINDS: readonly PieceKind[] = ["prop", "set_piece"];
export function isDirectKind(kind: string): boolean {
  return (DIRECT_KINDS as readonly string[]).includes(kind);
}

export const PIECE_KIND_LABELS: Record<PieceKind, string> = {
  dress: "Dress",
  vest: "Vest",
  pants: "Pants",
  shoes: "Shoes",
  accessory: "Accessory",
  prop: "Prop",
  set_piece: "Set piece",
};

export const PIECE_CONDITIONS = ["new", "good", "fair", "retire"] as const;
export type PieceCondition = (typeof PIECE_CONDITIONS)[number];

export const ALTERATION_STATUSES = [
  "none",
  "needed",
  "in_progress",
  "done",
] as const;
export type AlterationStatus = (typeof ALTERATION_STATUSES)[number];

export const ALTERATION_STATUS_LABELS: Record<AlterationStatus, string> = {
  none: "None",
  needed: "Needed",
  in_progress: "In progress",
  done: "Done",
};

// The alterations queue is everything still open (§4).
export const OPEN_ALTERATION_STATUSES: readonly AlterationStatus[] = [
  "needed",
  "in_progress",
];

// Quick status-advance on the alterations queue: needed → in_progress → done.
export function nextAlterationStatus(
  current: AlterationStatus,
): AlterationStatus {
  switch (current) {
    case "needed":
      return "in_progress";
    case "in_progress":
      return "done";
    default:
      return current;
  }
}

// ---------------------------------------------------------------------------
// Size-mismatch heuristic (§4: "mismatch renders a warning chip, never blocks")
// ---------------------------------------------------------------------------

// Size keys are program-defined and free-form (§3), so kind → size-key mapping
// is best-effort: candidate key fragments per kind, matched case-insensitively
// (exact or substring either direction). accessory/prop/set_piece map to nothing
// — we can't judge a mismatch, so we never show one.
const KIND_SIZE_KEYS: Record<PieceKind, readonly string[]> = {
  dress: ["dress"],
  vest: ["vest", "jacket", "coat", "top"],
  pants: ["pants", "bottom", "waist", "trouser"],
  shoes: ["shoe", "shoes"],
  accessory: [],
  prop: [],
  set_piece: [],
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// The student's size value most relevant to a piece of this kind, or null when
// none of the program's size keys plausibly apply.
export function relevantSizeValue(
  kind: string,
  sizes: Record<string, unknown> | null | undefined,
): string | null {
  const candidates = KIND_SIZE_KEYS[kind as PieceKind] ?? [];
  if (candidates.length === 0 || !sizes) return null;

  const entries: [string, string][] = Object.entries(sizes)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => [k.toLowerCase(), String(v)]);

  for (const c of candidates) {
    for (const [lk, v] of entries) {
      if (lk === c || lk.includes(c) || c.includes(lk)) return v;
    }
  }
  return null;
}

// True when the piece has a size_label, the student has a relevant size, and
// they differ. Purely advisory — callers render a chip, never block.
export function sizeMismatch(
  sizeLabel: string | null | undefined,
  kind: string,
  sizes: Record<string, unknown> | null | undefined,
): boolean {
  if (!sizeLabel || sizeLabel.trim() === "") return false;
  const rel = relevantSizeValue(kind, sizes);
  if (rel == null) return false;
  return normalize(sizeLabel) !== normalize(rel);
}
