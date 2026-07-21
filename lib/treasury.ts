import type { Role } from "@/lib/auth";

// Shared constants + PURE helpers for the treasury surface (T018–T020). Not a
// "use server" module — imported by both server components and server actions,
// and by the unit tests (money parsing/formatting are pure functions).
//
// Constitution V (money tracked, never touched): amounts are integer cents;
// entries void, never delete; only the `treasurer` role writes to the ledger
// and budget. Director/admin/board read everything and change nothing. Every
// write action re-checks TREASURY_WRITE_ROLES via requireRole (Constitution I,
// defense in depth) even though RLS also gates it.

// Only the treasurer writes money. This is the segregation-of-duties boundary
// (§2, Principle V). Reads are gated separately on TREASURY_ROLES in lib/nav.ts
// (director/admin/treasurer/board_member — NOT costume_manager).
export const TREASURY_WRITE_ROLES: readonly Role[] = ["treasurer"];

// Free-text fields (memos are the risk surface) carry the standing no-health
// label (Constitution III).
export const NO_HEALTH_LABEL = "Do not enter health or medical information.";

// ---------------------------------------------------------------------------
// Enums (mirror the 0001 foundation enums exactly)
// ---------------------------------------------------------------------------

export const BUDGET_STATUSES = ["draft", "active", "closed"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const CATEGORY_DIRECTIONS = ["income", "expense"] as const;
export type CategoryDirection = (typeof CATEGORY_DIRECTIONS)[number];

// Friendly labels for the budget-category direction dropdown. Stored value unchanged.
export const CATEGORY_DIRECTION_LABELS: Record<CategoryDirection, string> = {
  income: "Income",
  expense: "Expense",
};

export const LEDGER_DIRECTIONS = ["in", "out"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const LEDGER_DIRECTION_LABELS: Record<LedgerDirection, string> = {
  in: "In",
  out: "Out",
};

export function parseCategoryDirection(raw: string): CategoryDirection | null {
  return (CATEGORY_DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as CategoryDirection)
    : null;
}

export function parseLedgerDirection(raw: string): LedgerDirection | null {
  return (LEDGER_DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as LedgerDirection)
    : null;
}

// Postgres unique_violation — thrown when a second budget is activated for a
// season the partial unique index already guards (uq_budgets_one_active_per_season).
export const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Money: dollars → integer cents, and cents → display. INTEGER MATH ONLY.
// ---------------------------------------------------------------------------

// Parse a user-entered dollar string into integer cents using string handling
// only — never a float multiply (0.1 * 100 !== 10 in IEEE-754, and volunteers
// type "1,234.56"). Accepts optional "$", thousands commas, surrounding space,
// a leading "+", and up to two fractional digits. Rejects negatives (ledger
// amounts are CHECK > 0), >2 decimals, and anything non-numeric. Returns the
// cents integer, or null when the input isn't a clean non-negative amount.
//
//   "1,234.56" → 123456   "1234"   → 123400   ".5"  → 50
//   "$1,000"   → 100000   "0.09"   → 9         ""    → null
export function parseDollarsToCents(raw: string): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s === "") return null;

  // Strip currency symbol, thousands separators, and internal spaces.
  s = s.replace(/[$\s,]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  // Negatives are not valid ledger amounts (amount_cents CHECK > 0).
  if (s.startsWith("-")) return null;
  if (s === "") return null;

  // Digits with at most one decimal point.
  if (!/^\d*\.?\d*$/.test(s)) return null;
  if (!/\d/.test(s)) return null;

  const parts = s.split(".");
  if (parts.length > 2) return null;

  const whole = parts[0] === "" ? "0" : parts[0];
  let frac = parts.length === 2 ? parts[1] : "";
  if (frac.length > 2) return null; // finer than cents — reject, don't silently round
  frac = (frac + "00").slice(0, 2);

  const wholeCents = Number(whole) * 100; // integer * 100 stays integer
  const fracCents = Number(frac);
  if (!Number.isSafeInteger(wholeCents)) return null;
  return wholeCents + fracCents;
}

// Format integer cents as a localized USD string, negative-safe, built from
// integer parts so no float division ever rounds a balance wrong.
//   123456 → "$1,234.56"   -500 → "-$5.00"   0 → "$0.00"
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return "$0.00";
  const n = Math.trunc(cents);
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const wholeStr = new Intl.NumberFormat("en-US").format(whole);
  const fracStr = String(frac).padStart(2, "0");
  return `${negative ? "-" : ""}$${wholeStr}.${fracStr}`;
}

// Render a plain `date` column ("YYYY-MM-DD") without any timezone conversion —
// a ledger entry_date is a calendar day, not an instant, so constructing it as a
// local date avoids the UTC-midnight-shifts-back-a-day trap.
export function formatDateOnly(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return String(dateStr);
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

// Today as a "YYYY-MM-DD" string for a date input default (local wall clock).
export function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// ---------------------------------------------------------------------------
// "Start from template" seeder structure (§7). A starting point only — every
// category and line stays fully user-editable afterward. Income first, then
// expense; planned amounts seed at 0 (dollars are the program's to fill in).
// ---------------------------------------------------------------------------

export interface BudgetTemplateCategory {
  name: string;
  direction: CategoryDirection;
  lines: string[];
}

export const BUDGET_TEMPLATE: readonly BudgetTemplateCategory[] = [
  { name: "Dues", direction: "income", lines: ["Participation dues"] },
  {
    name: "Fundraising",
    direction: "income",
    lines: ["Fall fundraiser", "Spring fundraiser"],
  },
  {
    name: "Donations",
    direction: "income",
    lines: ["Sponsorships", "Individual gifts"],
  },
  {
    name: "Costumes",
    direction: "expense",
    lines: ["Costume purchases", "Alterations"],
  },
  { name: "Choreography", direction: "expense", lines: ["Choreographer fees"] },
  {
    name: "Travel",
    direction: "expense",
    lines: ["Bus charters", "Hotels", "Meals"],
  },
  { name: "Competition fees", direction: "expense", lines: ["Entry fees"] },
];

// ---------------------------------------------------------------------------
// Aggregation helpers (pure) — actuals from live ledger rows, kept out of the
// pages so the money math is unit-testable and consistent across every view.
// ---------------------------------------------------------------------------

export interface LedgerAmountRow {
  direction: LedgerDirection;
  amount_cents: number;
  voided_at: string | null;
  budget_line_id: string | null;
}

// Sum non-voided in/out totals over a set of ledger rows. Voided rows never
// count toward any balance (Principle V).
export function sumActuals(rows: readonly LedgerAmountRow[]): {
  inCents: number;
  outCents: number;
  netCents: number;
} {
  let inCents = 0;
  let outCents = 0;
  for (const r of rows) {
    if (r.voided_at) continue;
    if (r.direction === "in") inCents += r.amount_cents;
    else outCents += r.amount_cents;
  }
  return { inCents, outCents, netCents: inCents - outCents };
}

// Actual cents booked against one budget line (non-voided only). A line is
// income or expense by its category direction; we sum whichever ledger
// direction matches so a stray misdirected entry doesn't distort the line.
export function actualForLine(
  lineId: string,
  categoryDirection: CategoryDirection,
  rows: readonly LedgerAmountRow[],
): number {
  const want: LedgerDirection = categoryDirection === "income" ? "in" : "out";
  let total = 0;
  for (const r of rows) {
    if (r.voided_at) continue;
    if (r.budget_line_id !== lineId) continue;
    if (r.direction !== want) continue;
    total += r.amount_cents;
  }
  return total;
}

// Variance for a line, oriented so a positive number is always "good":
//   income  → actual − planned (beating the plan is positive)
//   expense → planned − actual (under budget is positive)
export function lineVariance(
  planned: number,
  actual: number,
  direction: CategoryDirection,
): number {
  return direction === "income" ? actual - planned : planned - actual;
}

// ---------------------------------------------------------------------------
// Monthly reconciliation (Wave L). The standard third money control alongside
// separation of duties + board transparency: each month, compare the ledger to
// the bank statement and mark it reconciled. All pure — the DB row is a status
// assertion, these helpers just bucket entries into months and compute how
// current the books are.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// A ledger entry_date is a plain calendar day ("YYYY-MM-DD", no timezone — see
// formatDateOnly). Its month bucket is just the year-month prefix; a plain date
// carries no instant, so converting it through a timezone would be wrong. Returns
// "YYYY-MM", or null for anything that isn't a valid date key.
export function monthKeyForDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(dateStr);
  return m ? `${m[1]}-${m[2]}` : null;
}

// First-of-month calendar-day key ("YYYY-MM" → "YYYY-MM-01"), the shape stored
// in ledger_reconciliations.month.
export function firstOfMonth(monthKey: string): string {
  return `${monthKey}-01`;
}

// "2026-07" → "July 2026". Engine-stable month names (no Intl month lookup, which
// varies by engine/locale) keep this pure and unit-testable. Falls back to the
// raw key when it isn't a valid "YYYY-MM".
export function formatMonthKey(monthKey: string | null | undefined): string {
  if (!monthKey) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(monthKey);
  if (!m) return String(monthKey);
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : String(monthKey);
}

export interface LedgerMonthRow {
  entry_date: string;
  voided_at: string | null;
}

// Distinct months (year-month keys) that carry at least one NON-VOIDED ledger
// entry, newest first. Drives the reconciliation card's row list — a month is
// reconcilable only once it has real activity; voided entries never anchor a
// month on their own (Principle V).
export function listMonthsWithEntries(rows: readonly LedgerMonthRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.voided_at) continue;
    const key = monthKeyForDate(r.entry_date);
    if (key) set.add(key);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

// The month the books are "reconciled through": the latest month-with-entries
// such that it AND every earlier month-with-entries is marked reconciled. A gap
// (an earlier active month left unreconciled) stops the run — the board gets an
// honest "current through" line, never a cherry-picked latest month. Returns a
// "YYYY-MM" key, or null when the earliest active month isn't reconciled yet.
export function reconciledThroughMonth(
  monthsWithEntries: readonly string[],
  reconciledMonths: readonly string[],
): string | null {
  const active = [...monthsWithEntries].sort((a, b) => a.localeCompare(b));
  const reconciled = new Set(reconciledMonths);
  let through: string | null = null;
  for (const m of active) {
    if (!reconciled.has(m)) break;
    through = m;
  }
  return through;
}
