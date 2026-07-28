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

// One parser per enum, shared by the pages that read them off the URL and the
// actions that read them off a form. Two copies of "is this a real kind?" is how
// a filter and a write drift into disagreeing about what the enum contains.
export function parsePieceKind(raw: string | null | undefined): PieceKind | null {
  return raw != null && (PIECE_KINDS as readonly string[]).includes(raw)
    ? (raw as PieceKind)
    : null;
}

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

// Friendly labels for the condition enum — the dropdown and badges show these
// instead of the raw stored value. DB values are unchanged.
export const PIECE_CONDITION_LABELS: Record<PieceCondition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  retire: "Retire",
};

export function parsePieceCondition(
  raw: string | null | undefined,
): PieceCondition | null {
  return raw != null && (PIECE_CONDITIONS as readonly string[]).includes(raw)
    ? (raw as PieceCondition)
    : null;
}

// Free-text inventory search ("where is dress 14?"). PostgREST's `or()` takes a
// comma-separated FILTER STRING, so whatever is typed has to be neutralized
// before it becomes part of that grammar: a comma would start a new filter, a
// paren would close the group, and `%`, `*` and `_` are all ilike wildcards we
// add ourselves (`_` matches any ONE character, so "dress_1" would quietly match
// "dress-1" too). Strip that punctuation, collapse whitespace, and cap the
// length — an inventory search is a label or a colour, never an expression.
// Returns null for anything that leaves nothing to search on.
export function pieceSearchTerm(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[,()*%_\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned || null;
}

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

export function parseAlterationStatus(
  raw: string | null | undefined,
): AlterationStatus | null {
  return raw != null && (ALTERATION_STATUSES as readonly string[]).includes(raw)
    ? (raw as AlterationStatus)
    : null;
}

// ---------------------------------------------------------------------------
// Costume changes (the quick-change model)
// ---------------------------------------------------------------------------

// A quick-change column is the gap BETWEEN two costume sets, in performance
// order: what comes off, what goes on. The sheet used to head each column with
// the raw pair and nothing else, which reads as jargon to everyone except the
// person who built the sets — so the label is derived here, once, and carries
// its position ("Change 2") alongside the human names ("Opener → Ballad").
export interface CostumeSetOrder {
  id: string;
  name: string;
}

export interface CostumeChange {
  /** 1-based position in the show — what the sheet calls "Change N". */
  number: number;
  from: CostumeSetOrder;
  to: CostumeSetOrder;
  /** "Opener → Ballad" — the two set names, never their sort numbers. */
  label: string;
}

// Consecutive pairs of an already-ordered set list. Fewer than two sets means
// there is no change to staff, and the caller says so instead of drawing an
// empty grid.
export function costumeChanges(
  sets: readonly CostumeSetOrder[],
): CostumeChange[] {
  return sets.slice(0, -1).map((from, i) => {
    const to = sets[i + 1];
    return { number: i + 1, from, to, label: `${from.name} → ${to.name}` };
  });
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
