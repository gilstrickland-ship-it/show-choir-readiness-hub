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

// WHICH BUDGET A SEASON'S SURFACES MEAN when they say "the budget". Rows come in
// newest-first; the ACTIVE one wins if there is one, otherwise the newest.
//
// Every treasury surface used to ask the database for this with
// `.order("status", { ascending: true }).limit(1)`, under a comment claiming
// "'active' < 'closed' < 'draft' alphabetically; prefer active". Postgres does
// not order an ENUM alphabetically — it orders by DECLARATION order, and
// budget_status is declared ('draft', 'active', 'closed') exactly as above. So
// that query preferred the DRAFT. A program that started next year's budget
// while this year's was still running read its whole ledger against the wrong
// plan on screen, while the downloadable board PDF — which picks 'active'
// explicitly — printed the other one. The two numbers went to the same meeting.
//
// One definition, in the language that is doing the comparing.
export function pickSeasonBudget<T extends { status: string }>(
  rows: readonly T[],
): T | null {
  return rows.find((b) => b.status === "active") ?? rows[0] ?? null;
}

export const CATEGORY_DIRECTIONS = ["income", "expense"] as const;
export type CategoryDirection = (typeof CATEGORY_DIRECTIONS)[number];

// Friendly labels for the budget-category direction dropdown. Stored value unchanged.
export const CATEGORY_DIRECTION_LABELS: Record<CategoryDirection, string> = {
  income: "Income",
  expense: "Expense",
};

export const LEDGER_DIRECTIONS = ["in", "out"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

// The first of the four decisions an entry asks for (spec 005 US8-1), so the
// label says what the direction MEANS rather than naming the enum. Stored value
// unchanged; the ledger filter offers the same two words.
export const LEDGER_DIRECTION_LABELS: Record<LedgerDirection, string> = {
  in: "In (money received)",
  out: "Out (money paid)",
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

// Free-text ledger search (spec 005 US8-3). PostgREST's `or()` takes a
// comma-separated FILTER STRING, so whatever a treasurer types has to be
// neutralized before it becomes part of that grammar: a comma would start a new
// filter, a paren would close the group, and `%`, `*` and `_` are all ilike
// wildcards we add ourselves (`_` matches any ONE character, which is why
// searching for "check_no" would otherwise quietly match "check-no" too).
// Strip that punctuation, collapse whitespace, and cap the length — a ledger
// search is a payee or a word from a memo, never an expression. Returns null
// for anything that leaves nothing to search on.
export function ledgerSearchTerm(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[,()*%_\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned || null;
}

// ---------------------------------------------------------------------------
// Ledger pagination (money-integrity fix, Wave-4 review F2)
// ---------------------------------------------------------------------------
// PostgREST caps a response at `max_rows` (1000 here and on the hosted default),
// so an un-paginated ledger silently stopped at an arbitrary prefix once a
// season grew past it — with nothing on screen saying so. The list now asks for
// one explicit page and states "showing X–Y of N", and every TOTAL is computed
// in SQL (ledger_season_totals) rather than summed over whatever rows arrived.
// The math is here so it is unit-testable and so the page and the footer can
// never disagree about which rows they are describing.

export const LEDGER_PAGE_SIZE = 100;

export interface LedgerPageRange {
  page: number; // 1-based, clamped into [1, pages]
  pages: number; // at least 1, even when there is nothing to show
  from: number; // 0-based inclusive index for PostgREST .range()
  to: number; // 0-based inclusive index for PostgREST .range()
  firstShown: number; // 1-based row number of the first row on this page (0 when empty)
  lastShown: number; // 1-based row number of the last row on this page (0 when empty)
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  // False when the COUNT query failed. `total` and `pages` are then guesses
  // built from the rows in hand, and the footer must not state them: a failed
  // count used to read as "0 of 0", which hid the pager entirely and left a
  // treasurer looking at exactly 100 entries with nothing saying there were
  // more.
  totalKnown: boolean;
}

// `?page=` off the URL: a positive integer, or 1 for anything else (a hand-typed
// "0", "-3", "2e9" or an array-valued param must not produce a negative range).
export function parsePageParam(raw: string | null | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  return n;
}

export function ledgerPageRange(
  total: number,
  page: number,
  pageSize: number = LEDGER_PAGE_SIZE,
): LedgerPageRange {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : LEDGER_PAGE_SIZE;
  const n = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(n / size));
  // Past the end is clamped rather than shown empty: a treasurer who bookmarked
  // page 9 of a ledger that shrank should land on the last real page, not on a
  // blank table that reads as "no entries".
  const current = Math.min(Math.max(parsePageParam(String(page)), 1), pages);
  const from = (current - 1) * size;
  const to = from + size - 1;
  const firstShown = n === 0 ? 0 : from + 1;
  const lastShown = n === 0 ? 0 : Math.min(to + 1, n);
  return {
    page: current,
    pages,
    from,
    to,
    firstShown,
    lastShown,
    total: n,
    hasPrev: current > 1,
    hasNext: current < pages,
    totalKnown: true,
  };
}

// The same page, described without a count. When the count query fails the LIST
// is still real — it is the total that is unknown — so paging has to keep
// working off the page number alone. `hasNext` is inferred the only honest way
// available: a page that came back full probably has another behind it. Asking
// for that page and finding it empty is a far better outcome than a pager that
// vanished and a list that stopped at 100 with no explanation.
export function ledgerPageRangeUnknownTotal(
  page: number,
  rowsOnPage: number,
  pageSize: number = LEDGER_PAGE_SIZE,
): LedgerPageRange {
  const size =
    Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : LEDGER_PAGE_SIZE;
  const current = parsePageParam(String(page));
  const from = (current - 1) * size;
  const shown = Number.isSafeInteger(rowsOnPage) && rowsOnPage > 0 ? rowsOnPage : 0;
  return {
    page: current,
    pages: current,
    from,
    to: from + size - 1,
    firstShown: shown === 0 ? 0 : from + 1,
    lastShown: shown === 0 ? 0 : from + shown,
    total: shown,
    hasPrev: current > 1,
    hasNext: shown === size,
    totalKnown: false,
  };
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
// Season aggregates — read from SQL, shaped here
// ---------------------------------------------------------------------------
// Every money total now comes from the 0019 aggregate functions, which return
// ONE row each, so no balance can depend on how many rows PostgREST was willing
// to hand back (`max_rows`, Wave-4 review F2). What is left in TypeScript is
// shaping and null-handling — and the null-handling is deliberate: a failed
// totals read returns null, never zeros, because "$0.00" is a number a
// treasurer would read to a board and a blank is not.

export interface LedgerSeasonTotals {
  inCents: number;
  outCents: number;
  netCents: number;
  entryCount: number;
  uncategorizedCount: number;
  uncategorizedCents: number;
  // "YYYY-MM" keys with at least one live entry, newest first.
  months: string[];
}

// One row of public.ledger_season_totals, or null/garbage when the read failed.
export function seasonTotalsFromRow(row: unknown): LedgerSeasonTotals | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const num = (key: string): number | null => {
    const v = r[key];
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const inCents = num("in_cents");
  const outCents = num("out_cents");
  const netCents = num("net_cents");
  const entryCount = num("entry_count");
  const uncategorizedCount = num("uncategorized_count");
  const uncategorizedCents = num("uncategorized_cents");
  if (
    inCents === null ||
    outCents === null ||
    netCents === null ||
    entryCount === null ||
    uncategorizedCount === null ||
    uncategorizedCents === null
  ) {
    return null;
  }
  const months = Array.isArray(r.months)
    ? r.months.filter((m): m is string => typeof m === "string")
    : [];
  return {
    inCents,
    outCents,
    netCents,
    entryCount,
    uncategorizedCount,
    uncategorizedCents,
    months,
  };
}

export interface LineActual {
  inCents: number;
  outCents: number;
}

// ---------------------------------------------------------------------------
// The same aggregates in TypeScript — for the ONE read that cannot call them
// ---------------------------------------------------------------------------
// The board-snapshot PDF is rendered by the export-all runner and the share-link
// routes on a SERVICE-ROLE client. There is no auth.uid() there, so
// private.ledger_may_read refuses — correctly. A fiduciary read guard is not the
// place to add an exception for convenience, so that path reads the season's
// live entries directly (PAGED, so no row cap can truncate it — see
// lib/pdf/queries.ts) and reduces them here.
//
// The reduction lives in one pure function, with the SQL definitions restated
// field for field:
//   .totals ≡ public.ledger_season_totals(program, season)
//   .byLine ≡ public.ledger_line_actuals(program, season)
// That is what makes "the PDF agrees with the page" a testable claim rather than
// a hope: tests/unit/treasury.spec.ts pins the definitions, and
// tests/rls/ledger.spec.ts runs BOTH paths over the same rows in real Postgres
// (past the 1000-row cap) and asserts they match.

// A ledger row as the raw select returns it. `amount_cents` is a bigint, which
// arrives as a string from node-postgres and as a number from PostgREST; both
// are accepted so one helper can serve both callers.
export interface LedgerEntryRow {
  direction: string;
  amount_cents: number | string;
  budget_line_id: string | null;
  entry_date: string;
  voided_at?: string | null;
  // The drawdown link (spec 006 R3). Absent on the older reads that never
  // select it, which is why it is optional rather than `string | null`.
  commitment_id?: string | null;
}

export interface SeasonLedgerSummary {
  totals: LedgerSeasonTotals;
  byLine: Map<string, LineActual>;
  // Cents booked against each commitment, in both directions, so the commitment
  // reducer can pick the one its kind means. Empty unless the caller selected
  // `commitment_id`.
  byCommitment: Map<string, LineActual>;
}

// A money reducer does not get to guess. An amount that will not read as a
// finite integer, or a direction that is neither 'in' nor 'out', means the read
// itself is broken — and a broken read that returns a plausible number is how a
// wrong balance reaches a board. Throw, and let the caller fail loudly.
function amountOf(row: LedgerEntryRow): number {
  const raw = row.amount_cents;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error("ledger entry with an unreadable amount");
  }
  return n;
}

export function summarizeSeasonLedger(
  rows: readonly LedgerEntryRow[],
): SeasonLedgerSummary {
  const byLine = new Map<string, LineActual>();
  const byCommitment = new Map<string, LineActual>();
  const months = new Set<string>();
  let inCents = 0;
  let outCents = 0;
  let entryCount = 0;
  let uncategorizedCount = 0;
  let uncategorizedCents = 0;

  for (const row of rows) {
    // Voided entries never count toward any total (Principle V). The fetch
    // already filters them; this is the belt to that suspenders, and it is what
    // lets a test feed a mixed list and still get the SQL's answer.
    if (row.voided_at) continue;
    if (row.direction !== "in" && row.direction !== "out") {
      throw new Error(`ledger entry with an unknown direction: ${row.direction}`);
    }
    const amount = amountOf(row);

    entryCount += 1;
    if (row.direction === "in") inCents += amount;
    else outCents += amount;

    const key = row.budget_line_id ?? UNCATEGORIZED_KEY;
    const bucket = byLine.get(key) ?? { inCents: 0, outCents: 0 };
    if (row.direction === "in") bucket.inCents += amount;
    else bucket.outCents += amount;
    byLine.set(key, bucket);

    if (row.budget_line_id === null) {
      uncategorizedCount += 1;
      uncategorizedCents += amount;
    }

    if (row.commitment_id) {
      const drawn = byCommitment.get(row.commitment_id) ?? { inCents: 0, outCents: 0 };
      if (row.direction === "in") drawn.inCents += amount;
      else drawn.outCents += amount;
      byCommitment.set(row.commitment_id, drawn);
    }

    const month = monthKeyForDate(row.entry_date);
    if (month) months.add(month);
  }

  return {
    totals: {
      inCents,
      outCents,
      netCents: inCents - outCents,
      entryCount,
      uncategorizedCount,
      uncategorizedCents,
      months: [...months].sort((a, b) => b.localeCompare(a)),
    },
    byLine,
    byCommitment,
  };
}

// public.ledger_line_actuals rows → lookup by budget line id. The row whose
// budget_line_id is null is the uncategorized bucket; it is keyed under
// UNCATEGORIZED_KEY so callers can ask for it by name.
export const UNCATEGORIZED_KEY = "";

export function lineActualsFromRows(rows: unknown): Map<string, LineActual> {
  const out = new Map<string, LineActual>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.budget_line_id === "string" ? r.budget_line_id : UNCATEGORIZED_KEY;
    const toNum = (v: unknown): number => {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    };
    out.set(id, { inCents: toNum(r.in_cents), outCents: toNum(r.out_cents) });
  }
  return out;
}

// Actual cents booked against a budget line, read the way its category means it:
// an income line counts money IN, an expense line counts money OUT, so a stray
// misdirected entry never inflates a line it does not belong to.
export function actualForDirection(
  actual: LineActual | undefined,
  categoryDirection: CategoryDirection,
): number {
  if (!actual) return 0;
  return categoryDirection === "income" ? actual.inCents : actual.outCents;
}

// Every cent booked against a line regardless of direction — what the board
// snapshot's category rollup and the per-event breakdown report.
export function totalForLine(actual: LineActual | undefined): number {
  if (!actual) return 0;
  return actual.inCents + actual.outCents;
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
// Commitments (spec 006) — Planned → Committed → Spent → Still available
// ---------------------------------------------------------------------------
// The ledger records money that HAS MOVED and a budget records what was
// PLANNED. Nothing recorded what has been PROMISED, so "how much of the costume
// budget is still free?" was unanswerable: $4,000 planned minus $800 spent read
// as $3,200 available when $3,200 was already committed to a vendor.
//
// VOCABULARY IS A REQUIREMENT HERE (R9), not a style choice. The word
// "encumbrance" never reaches a screen: the state is "Committed", a district
// commitment is a "Purchase order" (the word the bookkeeper will ask for), a
// booster one is "Approved spending", and the headline is "Still available".

export const COMMITMENT_KINDS = ["spending", "expected"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

export const COMMITMENT_FUNDING_SOURCES = ["district", "booster"] as const;
export type CommitmentFundingSource = (typeof COMMITMENT_FUNDING_SOURCES)[number];

// THE DELIBERATE ROLE RELAXATION (spec §4), mirrored from
// private.commitment_may_create so the form and the policy cannot drift. A
// director or admin may RAISE a request; only the treasurer approves, issues,
// receives and closes it (TREASURY_WRITE_ROLES above). Widening create is what
// makes requester ≠ approver possible at all — a treasurer-only model would
// force her to approve the requests she herself raised, which is the exact
// failure mode the database forbids with a CHECK.
export const COMMITMENT_CREATE_ROLES: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
];

// The subtypes, in the words a director uses. Never a direction toggle: an
// inbound purchase order is not a real accounting object (D4), so these name two
// different promises rather than two signs of one number.
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  spending: "Money we have promised to pay",
  expected: "Money someone has promised us",
};

// The plural heading each subtype gets its own section under.
export const COMMITMENT_KIND_HEADINGS: Record<CommitmentKind, string> = {
  spending: "Money we have promised",
  expected: "Money promised to us",
};

export const COMMITMENT_STATUSES = [
  "requested",
  "approved",
  "issued",
  "partially_received",
  "received",
  "closed",
  "cancelled",
  "superseded",
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

// Plain words for the lifecycle. "Superseded" is the one a bookkeeper would ask
// about, so it says what happened rather than naming the column.
export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  issued: "Issued",
  partially_received: "Partly received",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
  superseded: "Replaced by a revision",
};

// The two purses (D12). Identity, numbering and tax treatment never mix across
// them — a booster must never issue, or appear to issue, the district's purchase
// order. Only the reporting blends.
export const FUNDING_SOURCE_LABELS: Record<CommitmentFundingSource, string> = {
  district: "Purchase order",
  booster: "Approved spending",
};

export function parseCommitmentKind(raw: string): CommitmentKind | null {
  return (COMMITMENT_KINDS as readonly string[]).includes(raw)
    ? (raw as CommitmentKind)
    : null;
}

export function parseFundingSource(raw: string): CommitmentFundingSource | null {
  return (COMMITMENT_FUNDING_SOURCES as readonly string[]).includes(raw)
    ? (raw as CommitmentFundingSource)
    : null;
}

// How a commitment is named out loud. A revision keeps the original's number —
// it is the same document restated, which is what makes "PO 1042 · rev 2"
// readable to a bookkeeper who has 1042 in the district's own system.
export function commitmentRefLabel(
  source: CommitmentFundingSource,
  numberValue: number,
  revision = 0,
): string {
  const base =
    source === "district"
      ? `PO ${numberValue}`
      : `Approved spending #${numberValue}`;
  return revision > 0 ? `${base} · rev ${revision}` : base;
}

// ---------------------------------------------------------------------------
// The lifecycle — one definition, shared by the buttons and the writes
// ---------------------------------------------------------------------------
// request → approve → issue → partially received → received → closed, plus
// cancel and revise from any open state.
//
// THE DATABASE DOES NOT ENFORCE THIS ORDER and deliberately so: 0021 constrains
// the STAMPS (set once, never cleared, never inconsistent with the status) and
// gates WHO may move them (treasurer, by RLS). What order the moves come in is a
// workflow question, not a fiduciary one, so it lives here — in one pure
// function that the row's buttons and the server action both ask, rather than in
// an `if` beside each button and a second `if` inside each action, which is how
// a control that is hidden becomes a control that still works when posted.

export const COMMITMENT_ACTIONS = [
  "approve",
  "issue",
  "receive_partial",
  "receive_full",
  "close",
  "cancel",
  "revise",
] as const;
export type CommitmentAction = (typeof COMMITMENT_ACTIONS)[number];

export function parseCommitmentAction(raw: string): CommitmentAction | null {
  return (COMMITMENT_ACTIONS as readonly string[]).includes(raw)
    ? (raw as CommitmentAction)
    : null;
}

// A document still stands when it has not been cancelled and has not been
// replaced by its own revision; it is still OPEN when it also has not been
// closed. Closing is what releases the remainder, so a closed commitment is
// still a fact about the season and is no longer committing anything — the same
// split the SQL aggregates make (`is_standing` / `is_open`).
export interface CommitmentState {
  status: string;
  closed_at: string | null;
  cancelled_at: string | null;
  superseded_at: string | null;
}

export function commitmentIsStanding(row: CommitmentState): boolean {
  return row.cancelled_at === null && row.superseded_at === null;
}

export function commitmentIsOpen(row: CommitmentState): boolean {
  return commitmentIsStanding(row) && row.closed_at === null;
}

// Which moves this document can make next. An action not listed here is refused
// by the server action too, with the same answer, because both call this.
export function commitmentAllows(
  row: CommitmentState,
  action: CommitmentAction,
): boolean {
  if (!commitmentIsOpen(row)) return false;
  switch (action) {
    case "approve":
      return row.status === "requested";
    case "issue":
      return row.status === "approved";
    case "receive_partial":
      return row.status === "issued";
    case "receive_full":
      return row.status === "issued" || row.status === "partially_received";
    // Closing, cancelling and revising are available for as long as the
    // document is open. A request that was never approved still has to be able
    // to go away, and a real purchase order gets revised before it is issued far
    // more often than after.
    case "close":
    case "cancel":
    case "revise":
      return true;
  }
}

// What a lifecycle move writes. Kept beside `commitmentAllows` so the transition
// and its stamps are read together: a status and its stamp are the same fact
// said twice (0021's CHECK constraints), and setting one without the other is
// rejected by the engine.
export const COMMITMENT_ACTION_STATUS: Record<
  Exclude<CommitmentAction, "revise">,
  CommitmentStatus
> = {
  approve: "approved",
  issue: "issued",
  receive_partial: "partially_received",
  receive_full: "received",
  close: "closed",
  cancel: "cancelled",
};

// ---------------------------------------------------------------------------
// The drawdown, in one sentence (R3)
// ---------------------------------------------------------------------------
// "committed $3,200 · paid $3,050 · $150 still committed" — and the same shape
// for the inbound subtype, which is received rather than paid and expected
// rather than committed. Overspend is APPENDED, never substituted: R5 says an
// overrun warns and never blocks, so the sentence still reports what was
// promised and what has moved, and then says by how much reality went past it.

export function commitmentTotalCents(row: {
  amount_cents: number;
  shipping_cents: number;
  tax_cents: number;
}): number {
  return row.amount_cents + row.shipping_cents + row.tax_cents;
}

export function commitmentRemaining(total: number, drawn: number): number {
  return Math.max(total - drawn, 0);
}

export function commitmentOverspend(total: number, drawn: number): number {
  return Math.max(drawn - total, 0);
}

export function drawdownSentence(
  kind: CommitmentKind,
  total: number,
  drawn: number,
): string {
  const moved = kind === "spending" ? "paid" : "received";
  const held = kind === "spending" ? "still committed" : "still expected";
  const promised = kind === "spending" ? "committed" : "expected";
  const over = commitmentOverspend(total, drawn);
  const base = `${promised} ${formatCents(total)} · ${moved} ${formatCents(drawn)} · ${formatCents(commitmentRemaining(total, drawn))} ${held}`;
  return over > 0 ? `${base} · ${formatCents(over)} over` : base;
}

// One row of public.commitment_totals.
export interface CommitmentTotals {
  openCommittedCents: number; // open SPENDING, remaining after drawdown
  openExpectedCents: number; // open EXPECTED, remaining after receipts
  committedGrossCents: number; // open spending, before drawdown
  drawnCents: number; // paid against open spending commitments
  openCount: number;
  expectedCount: number;
  staleCount: number; // open, need-by already past on the program's calendar
  overspentCount: number;
  afterTheFactCount: number;
}

export interface LineCommitment {
  openCommittedCents: number;
  openExpectedCents: number;
}

// A failed read returns null, never zeros — the same rule the ledger totals
// follow, for the same reason: "$0.00 committed" is a number a director would
// act on, and a blank is not.
export function commitmentTotalsFromRow(row: unknown): CommitmentTotals | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const num = (key: string): number | null => {
    const v = r[key];
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const fields = {
    openCommittedCents: num("open_committed_cents"),
    openExpectedCents: num("open_expected_cents"),
    committedGrossCents: num("committed_gross_cents"),
    drawnCents: num("drawn_cents"),
    openCount: num("open_count"),
    expectedCount: num("expected_count"),
    staleCount: num("stale_count"),
    overspentCount: num("overspent_count"),
    afterTheFactCount: num("after_the_fact_count"),
  };
  for (const value of Object.values(fields)) {
    if (value === null) return null;
  }
  return fields as CommitmentTotals;
}

// public.commitment_line_totals rows → lookup by budget line id. Unlike the
// ledger's line actuals there is no uncategorized bucket: a commitment without a
// budget line cannot exist (no line, no encumbrance, no math), so the column is
// NOT NULL in the schema.
export function commitmentLineTotalsFromRows(rows: unknown): Map<string, LineCommitment> {
  const out = new Map<string, LineCommitment>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.budget_line_id !== "string") continue;
    const toNum = (v: unknown): number => {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    };
    out.set(r.budget_line_id, {
      openCommittedCents: toNum(r.open_committed_cents),
      openExpectedCents: toNum(r.open_expected_cents),
    });
  }
  return out;
}

// One row of public.commitment_drawdown_rows (0022) — what is left on ONE
// document. The definitions are 0021's `private.commitment_drawdown`; nothing is
// recomputed here.
export interface CommitmentDrawdown {
  totalCents: number;
  drawnCents: number;
  remainingCents: number;
  isOpen: boolean;
  isStanding: boolean;
}

// Keyed by commitment id. A row that is ABSENT is absent on purpose: the caller
// renders "—" for it rather than a zero, the same rule the ledger's running
// balance follows, because "$0.00 still committed" is a sentence a treasurer
// would act on and a dash is not.
export function commitmentDrawdownFromRows(
  rows: unknown,
): Map<string, CommitmentDrawdown> {
  const out = new Map<string, CommitmentDrawdown>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.commitment_id !== "string") continue;
    const num = (key: string): number | null => {
      const v = r[key];
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    };
    const totalCents = num("total_cents");
    const drawnCents = num("drawn_cents");
    const remainingCents = num("remaining_cents");
    // A row that will not read as three finite numbers is a broken read, not a
    // commitment with nothing on it — drop it, and let the caller print a dash.
    if (totalCents === null || drawnCents === null || remainingCents === null) {
      continue;
    }
    out.set(r.commitment_id, {
      totalCents,
      drawnCents,
      remainingCents,
      isOpen: r.is_open === true,
      isStanding: r.is_standing === true,
    });
  }
  return out;
}

// THE HEADLINE NUMBER. Planned, minus what has actually been spent, minus what
// is still promised to a vendor. Expected money is NOT added: you may not spend
// money you have merely been promised (spec §2 — the asymmetry is the accounting
// reality, not an oversight).
export function stillAvailable(
  planned: number,
  spent: number,
  committed: number,
): number {
  return planned - spent - committed;
}

// ---------------------------------------------------------------------------
// The same aggregates in TypeScript — for the ONE read that cannot call them
// ---------------------------------------------------------------------------
// Identical situation to summarizeSeasonLedger above: the board-snapshot PDF
// runs on a service-role client with no auth.uid(), so private.ledger_may_read
// refuses and it must page the rows and reduce them here. The SQL definitions
// are restated field for field, and tests/rls/commitments.spec.ts runs BOTH over
// the same rows in real Postgres, past the 1000-row cap, to prove they agree.
//
//   .totals ≡ public.commitment_totals(program, season)
//   .byLine ≡ public.commitment_line_totals(program, season)

export interface CommitmentRow {
  id: string;
  kind: string;
  budget_line_id: string;
  amount_cents: number | string;
  shipping_cents: number | string;
  tax_cents: number | string;
  need_by: string | null;
  after_the_fact: boolean;
  closed_at: string | null;
  cancelled_at: string | null;
  superseded_at: string | null;
}

export interface CommitmentSummary {
  totals: CommitmentTotals;
  byLine: Map<string, LineCommitment>;
}

// Same posture as the ledger reducer: an amount that will not read as a finite
// number means the READ is broken, and a broken read that returns a plausible
// number is how a wrong balance reaches a board.
function centsOf(raw: number | string, what: string): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`commitment with an unreadable ${what}`);
  }
  return n;
}

export function summarizeCommitments(
  rows: readonly CommitmentRow[],
  // Cents booked against each commitment, both directions — summarizeSeasonLedger's
  // `byCommitment`, which is the live-entries-only set by construction.
  drawnByCommitment: ReadonlyMap<string, LineActual>,
  // Today on the PROGRAM's calendar ("YYYY-MM-DD"). A need-by is a calendar day,
  // so a plain string compare is the whole comparison — and a UTC host must not
  // decide that a Chicago program's purchase order is late (Constitution VII).
  today: string,
): CommitmentSummary {
  const byLine = new Map<string, LineCommitment>();
  const totals: CommitmentTotals = {
    openCommittedCents: 0,
    openExpectedCents: 0,
    committedGrossCents: 0,
    drawnCents: 0,
    openCount: 0,
    expectedCount: 0,
    staleCount: 0,
    overspentCount: 0,
    afterTheFactCount: 0,
  };

  for (const row of rows) {
    if (row.kind !== "spending" && row.kind !== "expected") {
      throw new Error(`commitment with an unknown kind: ${row.kind}`);
    }
    const total =
      centsOf(row.amount_cents, "amount") +
      centsOf(row.shipping_cents, "shipping") +
      centsOf(row.tax_cents, "tax");

    // A misdirected entry never draws down a commitment it does not belong to:
    // a spending commitment is paid down by money OUT, an expected one by money
    // IN (the same rule actualForDirection applies to a budget line).
    const drawnBoth = drawnByCommitment.get(row.id);
    const drawn =
      (row.kind === "spending" ? drawnBoth?.outCents : drawnBoth?.inCents) ?? 0;
    const remaining = Math.max(total - drawn, 0);

    // Superseded and cancelled documents no longer stand; a CLOSED one is still
    // a fact about the season but is no longer committing anything.
    const standing = row.cancelled_at === null && row.superseded_at === null;
    const open = standing && row.closed_at === null;

    if (standing) {
      if (drawn > total) totals.overspentCount += 1;
      if (row.after_the_fact) totals.afterTheFactCount += 1;
    }
    if (!open) continue;

    if (row.need_by !== null && row.need_by < today) totals.staleCount += 1;

    const bucket = byLine.get(row.budget_line_id) ?? {
      openCommittedCents: 0,
      openExpectedCents: 0,
    };
    if (row.kind === "spending") {
      totals.openCommittedCents += remaining;
      totals.committedGrossCents += total;
      totals.drawnCents += drawn;
      totals.openCount += 1;
      bucket.openCommittedCents += remaining;
    } else {
      totals.openExpectedCents += remaining;
      totals.expectedCount += 1;
      bucket.openExpectedCents += remaining;
    }
    byLine.set(row.budget_line_id, bucket);
  }

  return { totals, byLine };
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

// The month list a reconciliation run works from — distinct months carrying at
// least one non-voided entry, newest first — now comes from the season
// aggregate: `ledger_season_totals.months` on every screen, and the identical
// field of summarizeSeasonLedger on the one service-role path that cannot call
// it. One definition, so no surface can offer a month another surface does not
// have.

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
