// ============================================================================
// Unit tests — treasury money helpers (T018–T020 shared pure functions)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no network (runs under vitest.unit.config.ts).
// Constitution V: money is integer cents, parsed by string handling (never a
// float multiply) and formatted negative-safe. A cent lost to IEEE-754 rounding
// is a bug in a booster nonprofit's books — these lock the edges.
// ============================================================================

import { describe, test, expect } from "vitest";
import {
  parseDollarsToCents,
  formatCents,
  ledgerSearchTerm,
  lineVariance,
  actualForDirection,
  lineActualsFromRows,
  seasonTotalsFromRow,
  summarizeSeasonLedger,
  totalForLine,
  ledgerPageRange,
  ledgerPageRangeUnknownTotal,
  parsePageParam,
  monthKeyForDate,
  firstOfMonth,
  formatMonthKey,
  reconciledThroughMonth,
  LEDGER_PAGE_SIZE,
  UNCATEGORIZED_KEY,
  // Commitments (spec 006) — the layer between planned and spent.
  COMMITMENT_APPROVE_ROLES,
  COMMITMENT_CREATE_ROLES,
  COMMITMENT_THRESHOLD_DEFAULTS,
  approvalActorsFromRows,
  commitmentRules,
  commitmentThresholds,
  overThreshold,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_KIND_HEADINGS,
  COMMITMENT_STATUS_LABELS,
  COMMITMENT_STATUSES,
  FUNDING_SOURCE_LABELS,
  TREASURY_WRITE_ROLES,
  commitmentAllows,
  commitmentDrawdownFromRows,
  commitmentIsOpen,
  commitmentIsStanding,
  commitmentLineTotalsFromRows,
  commitmentOverspend,
  commitmentRefLabel,
  commitmentRemaining,
  commitmentTotalCents,
  commitmentTotalsFromRow,
  drawdownSentence,
  parseCommitmentKind,
  parseFundingSource,
  stillAvailable,
  type CommitmentAction,
  type CommitmentState,
} from "@/lib/treasury";

describe("parseDollarsToCents", () => {
  test("thousands comma + two decimals", () => {
    expect(parseDollarsToCents("1,234.56")).toBe(123456);
  });

  test("plain integer dollars imply .00", () => {
    expect(parseDollarsToCents("1234")).toBe(123400);
  });

  test("one decimal place pads to two", () => {
    expect(parseDollarsToCents("1234.5")).toBe(123450);
  });

  test("leading-dot fraction", () => {
    expect(parseDollarsToCents(".5")).toBe(50);
    expect(parseDollarsToCents(".09")).toBe(9);
  });

  test("currency symbol and spaces are stripped", () => {
    expect(parseDollarsToCents("  $1,000  ")).toBe(100000);
    expect(parseDollarsToCents("$ 12.34")).toBe(1234);
  });

  test("leading plus is allowed", () => {
    expect(parseDollarsToCents("+12.34")).toBe(1234);
  });

  test("zero forms", () => {
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("0.00")).toBe(0);
    expect(parseDollarsToCents("0.0")).toBe(0);
  });

  test("no float-rounding drift on the classic 0.1/0.2/0.29 traps", () => {
    expect(parseDollarsToCents("0.10")).toBe(10);
    expect(parseDollarsToCents("0.20")).toBe(20);
    expect(parseDollarsToCents("0.29")).toBe(29);
    expect(parseDollarsToCents("19.99")).toBe(1999);
  });

  test("large value stays exact", () => {
    expect(parseDollarsToCents("1,000,000.00")).toBe(100000000);
  });

  test("rejects more precision than cents", () => {
    expect(parseDollarsToCents("1.234")).toBeNull();
  });

  test("rejects negatives (amounts are CHECK > 0)", () => {
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("-0.01")).toBeNull();
  });

  test("rejects junk and empties", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("   ")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1.2.3")).toBeNull();
    expect(parseDollarsToCents("$")).toBeNull();
    expect(parseDollarsToCents(".")).toBeNull();
    // @ts-expect-error non-string guard
    expect(parseDollarsToCents(null)).toBeNull();
  });
});

describe("formatCents", () => {
  test("thousands separator and cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  test("zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  test("sub-dollar pads", () => {
    expect(formatCents(9)).toBe("$0.09");
    expect(formatCents(50)).toBe("$0.50");
  });

  test("negative is sign-prefixed (variance can go negative)", () => {
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(-123456)).toBe("-$1,234.56");
    expect(formatCents(-9)).toBe("-$0.09");
  });

  test("large value", () => {
    expect(formatCents(100000000)).toBe("$1,000,000.00");
  });

  test("round-trips with parseDollarsToCents", () => {
    for (const s of ["1,234.56", "0.09", "1000", "19.99"]) {
      const cents = parseDollarsToCents(s)!;
      expect(formatCents(cents)).toBe(formatCents(cents));
      expect(parseDollarsToCents(formatCents(cents))).toBe(cents);
    }
  });

  test("non-finite guards to zero", () => {
    expect(formatCents(NaN)).toBe("$0.00");
    expect(formatCents(Infinity)).toBe("$0.00");
  });
});

describe("lineVariance", () => {
  test("expense under budget is positive", () => {
    expect(lineVariance(100000, 80000, "expense")).toBe(20000);
  });
  test("expense over budget is negative", () => {
    expect(lineVariance(100000, 120000, "expense")).toBe(-20000);
  });
  test("income beating plan is positive", () => {
    expect(lineVariance(50000, 60000, "income")).toBe(10000);
  });
  test("income short of plan is negative", () => {
    expect(lineVariance(50000, 40000, "income")).toBe(-10000);
  });
});

// Every money total now arrives as a SQL aggregate (migration 0019) instead of
// being summed in JavaScript over a fetched row list, which silently stopped at
// PostgREST's 1000-row cap. What is left to test here is the shaping — and
// above all that a FAILED read produces null, never zeros: "$0.00" is a number a
// treasurer would read aloud to a board, and a blank is not.
describe("seasonTotalsFromRow", () => {
  const row = {
    in_cents: 250000,
    out_cents: 90000,
    net_cents: 160000,
    entry_count: 42,
    uncategorized_count: 3,
    uncategorized_cents: 12500,
    months: ["2026-07", "2026-06"],
  };

  test("maps a whole aggregate row", () => {
    expect(seasonTotalsFromRow(row)).toEqual({
      inCents: 250000,
      outCents: 90000,
      netCents: 160000,
      entryCount: 42,
      uncategorizedCount: 3,
      uncategorizedCents: 12500,
      months: ["2026-07", "2026-06"],
    });
  });

  test("accepts bigint columns delivered as strings", () => {
    expect(seasonTotalsFromRow({ ...row, in_cents: "250000" })?.inCents).toBe(250000);
  });

  test("a missing or malformed row is null, NOT a zeroed total", () => {
    expect(seasonTotalsFromRow(null)).toBeNull();
    expect(seasonTotalsFromRow(undefined)).toBeNull();
    expect(seasonTotalsFromRow("nope")).toBeNull();
    expect(seasonTotalsFromRow({ ...row, net_cents: null })).toBeNull();
    expect(seasonTotalsFromRow({})).toBeNull();
  });

  test("a season with no months at all still maps", () => {
    expect(seasonTotalsFromRow({ ...row, months: null })?.months).toEqual([]);
  });
});

// The board-snapshot PDF is the ONE money read that cannot call those SQL
// aggregates: the export runner and the share-link routes build it on a
// service-role client, where auth.uid() is null and private.ledger_may_read
// refuses. So it pages the raw rows and reduces them here — and "the PDF agrees
// with the page" is only true if this reduction IS the SQL's definition. These
// pin the definition; tests/rls/ledger.spec.ts then runs both over the same rows
// in real Postgres, past the row cap, and asserts they match.
describe("summarizeSeasonLedger — the SQL aggregates, restated in TypeScript", () => {
  const rows = [
    { direction: "in", amount_cents: 100000, budget_line_id: "L1", entry_date: "2026-07-04" },
    { direction: "in", amount_cents: 25000, budget_line_id: "L1", entry_date: "2026-07-19" },
    { direction: "out", amount_cents: 40000, budget_line_id: "L2", entry_date: "2026-06-02" },
    { direction: "out", amount_cents: 7500, budget_line_id: null, entry_date: "2026-06-30" },
    { direction: "in", amount_cents: 500, budget_line_id: null, entry_date: "2026-05-11" },
  ];

  test("totals match ledger_season_totals field for field", () => {
    expect(summarizeSeasonLedger(rows).totals).toEqual({
      inCents: 125500,
      outCents: 47500,
      netCents: 78000,
      entryCount: 5,
      uncategorizedCount: 2,
      uncategorizedCents: 8000,
      months: ["2026-07", "2026-06", "2026-05"], // newest first, as array_agg orders it
    });
  });

  test("byLine matches ledger_line_actuals, uncategorized in its own bucket", () => {
    const { byLine } = summarizeSeasonLedger(rows);
    expect(byLine.get("L1")).toEqual({ inCents: 125000, outCents: 0 });
    expect(byLine.get("L2")).toEqual({ inCents: 0, outCents: 40000 });
    expect(byLine.get(UNCATEGORIZED_KEY)).toEqual({ inCents: 500, outCents: 7500 });
  });

  // Same shape either way: PostgREST hands bigints back as numbers, node-postgres
  // as strings, and one helper serves the app and the cross-path RLS test.
  test("bigints delivered as strings count the same", () => {
    const asStrings = rows.map((r) => ({ ...r, amount_cents: String(r.amount_cents) }));
    expect(summarizeSeasonLedger(asStrings).totals).toEqual(
      summarizeSeasonLedger(rows).totals,
    );
  });

  // Principle V: a voided entry is not money. The fetch filters them out, and so
  // does this — a total that counted one would be wrong in the direction that
  // matters most (money that looks like it is still there).
  test("voided rows count toward nothing", () => {
    const withVoid = [
      ...rows,
      {
        direction: "in",
        amount_cents: 999999,
        budget_line_id: "L1",
        entry_date: "2026-07-05",
        voided_at: "2026-07-06T00:00:00Z",
      },
    ];
    expect(summarizeSeasonLedger(withVoid).totals).toEqual(
      summarizeSeasonLedger(rows).totals,
    );
  });

  test("an empty season is zeros and no months, not an absent answer", () => {
    expect(summarizeSeasonLedger([]).totals).toEqual({
      inCents: 0,
      outCents: 0,
      netCents: 0,
      entryCount: 0,
      uncategorizedCount: 0,
      uncategorizedCents: 0,
      months: [],
    });
  });

  // A money reducer does not get to guess. An unreadable amount or an unknown
  // direction means the READ is broken, and a broken read that still returns a
  // plausible number is how a wrong balance reaches a board.
  test("an unreadable amount throws instead of contributing zero", () => {
    expect(() =>
      summarizeSeasonLedger([
        { direction: "in", amount_cents: "not money", budget_line_id: null, entry_date: "2026-07-04" },
      ]),
    ).toThrow(/unreadable amount/);
  });

  test("an unknown direction throws instead of being counted as an outflow", () => {
    expect(() =>
      summarizeSeasonLedger([
        { direction: "sideways", amount_cents: 100, budget_line_id: null, entry_date: "2026-07-04" },
      ]),
    ).toThrow(/unknown direction/);
  });
});

describe("lineActualsFromRows / actualForDirection / totalForLine", () => {
  const rows = [
    { budget_line_id: "L1", in_cents: 10000, out_cents: 0 },
    { budget_line_id: "L2", in_cents: 0, out_cents: 4000 },
    { budget_line_id: null, in_cents: 0, out_cents: 2500 }, // uncategorized bucket
  ];
  const map = lineActualsFromRows(rows);

  test("keys by line id, with the null line under the uncategorized key", () => {
    expect(map.get("L1")).toEqual({ inCents: 10000, outCents: 0 });
    expect(map.get(UNCATEGORIZED_KEY)).toEqual({ inCents: 0, outCents: 2500 });
  });

  test("a non-array (a failed read) yields an empty map, not a throw", () => {
    expect(lineActualsFromRows(null).size).toBe(0);
    expect(lineActualsFromRows({ oops: true }).size).toBe(0);
  });

  test("actualForDirection reads a line the way its category means it", () => {
    expect(actualForDirection(map.get("L1"), "income")).toBe(10000);
    expect(actualForDirection(map.get("L2"), "expense")).toBe(4000);
    // wrong direction contributes nothing — a stray entry never inflates a line
    expect(actualForDirection(map.get("L1"), "expense")).toBe(0);
    expect(actualForDirection(undefined, "income")).toBe(0);
  });

  test("totalForLine is every cent booked to the line, both directions", () => {
    expect(totalForLine({ inCents: 10000, outCents: 4000 })).toBe(14000);
    expect(totalForLine(undefined)).toBe(0);
  });
});

// The ledger list is explicitly paginated because PostgREST truncates at
// `max_rows` with no signal. The arithmetic below is what the "showing X–Y of N"
// line promises, so it is pinned: an off-by-one here is a treasurer being told
// she is looking at rows she is not.
describe("parsePageParam", () => {
  test("a positive integer passes through", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(" 12 ")).toBe(12);
  });

  test("anything that isn't a page number falls back to page 1", () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-4")).toBe(1); // must never produce a negative range
    expect(parsePageParam("1.5")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("1e400")).toBe(1);
    // Next hands back an array for a duplicated ?page=
    expect(parsePageParam(["2", "3"] as unknown as string)).toBe(1);
  });
});

describe("ledgerPageRange", () => {
  test("first page of a long ledger", () => {
    expect(ledgerPageRange(412, 1, 100)).toEqual({
      page: 1,
      pages: 5,
      from: 0,
      to: 99,
      firstShown: 1,
      lastShown: 100,
      total: 412,
      hasPrev: false,
      hasNext: true,
      totalKnown: true,
    });
  });

  test("a middle page counts from the right offset", () => {
    const r = ledgerPageRange(412, 3, 100);
    expect([r.from, r.to]).toEqual([200, 299]);
    expect([r.firstShown, r.lastShown]).toEqual([201, 300]);
    expect([r.hasPrev, r.hasNext]).toEqual([true, true]);
  });

  test("the last page stops at the real total, not at the page size", () => {
    const r = ledgerPageRange(412, 5, 100);
    expect([r.firstShown, r.lastShown]).toEqual([401, 412]);
    expect(r.hasNext).toBe(false);
  });

  test("an exact multiple does not invent an empty trailing page", () => {
    const r = ledgerPageRange(400, 4, 100);
    expect(r.pages).toBe(4);
    expect([r.firstShown, r.lastShown]).toEqual([301, 400]);
    expect(r.hasNext).toBe(false);
  });

  test("past the end clamps to the last real page", () => {
    const r = ledgerPageRange(150, 99, 100);
    expect(r.page).toBe(2);
    expect([r.firstShown, r.lastShown]).toEqual([101, 150]);
  });

  test("an empty ledger is one page showing nothing", () => {
    const r = ledgerPageRange(0, 1, 100);
    expect(r).toEqual({
      page: 1,
      pages: 1,
      from: 0,
      to: 99,
      firstShown: 0,
      lastShown: 0,
      total: 0,
      hasPrev: false,
      hasNext: false,
      totalKnown: true,
    });
  });

  test("a single entry reads 1–1 of 1", () => {
    const r = ledgerPageRange(1, 1, 100);
    expect([r.firstShown, r.lastShown, r.pages]).toEqual([1, 1, 1]);
  });

  test("a counted range always says its total is known", () => {
    expect(ledgerPageRange(412, 2, 100).totalKnown).toBe(true);
  });

  test("nonsense totals and page sizes degrade to a safe first page", () => {
    expect(ledgerPageRange(-5, 1, 100).total).toBe(0);
    expect(ledgerPageRange(NaN, 1, 100).total).toBe(0);
    const r = ledgerPageRange(250, 1, 0);
    expect(r.to - r.from + 1).toBe(LEDGER_PAGE_SIZE);
  });

  test("the default page size is the one the ledger actually uses", () => {
    const r = ledgerPageRange(1000, 2);
    expect([r.from, r.to]).toEqual([LEDGER_PAGE_SIZE, LEDGER_PAGE_SIZE * 2 - 1]);
  });
});

// ---------------------------------------------------------------------------
// A FAILED COUNT IS NOT A COUNT OF ZERO
// ---------------------------------------------------------------------------
// The ledger page dropped the count query's error, so a transient failure gave
// `count: null` → ledgerPageRange(0, …) → total 0, pages 1, hasNext false. The
// pager returns null on a zero total, so the treasurer saw exactly 100 entries
// with NOTHING on screen saying the ledger continued past them — the most
// dangerous shape a money list can take, because it looks complete.
describe("ledgerPageRangeUnknownTotal", () => {
  test("a full page keeps Older available even with no total to show", () => {
    const r = ledgerPageRangeUnknownTotal(1, 100, 100);
    expect(r.totalKnown).toBe(false);
    expect(r.hasNext).toBe(true);
    expect(r.hasPrev).toBe(false);
    expect([r.firstShown, r.lastShown]).toEqual([1, 100]);
    expect([r.from, r.to]).toEqual([0, 99]);
  });

  test("a short page is the end of the list", () => {
    const r = ledgerPageRangeUnknownTotal(3, 12, 100);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(true);
    expect([r.firstShown, r.lastShown]).toEqual([201, 212]);
  });

  test("an empty page past the end offers the way back, not a phantom next", () => {
    const r = ledgerPageRangeUnknownTotal(4, 0, 100);
    expect([r.firstShown, r.lastShown]).toEqual([0, 0]);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(true);
  });

  test("a hand-typed page number still lands on a real range", () => {
    const r = ledgerPageRangeUnknownTotal(-3, 100, 100);
    expect(r.page).toBe(1);
    expect([r.from, r.to]).toEqual([0, 99]);
  });

  test("it never claims a total it does not have", () => {
    expect(ledgerPageRangeUnknownTotal(2, 100, 100).totalKnown).toBe(false);
  });
});

describe("monthly reconciliation helpers (Wave L)", () => {
  test("monthKeyForDate takes the plain year-month prefix (no tz math)", () => {
    expect(monthKeyForDate("2026-07-21")).toBe("2026-07");
    expect(monthKeyForDate("2026-01-01T00:00:00Z")).toBe("2026-01");
    expect(monthKeyForDate(null)).toBeNull();
    expect(monthKeyForDate("nonsense")).toBeNull();
  });

  test("firstOfMonth appends -01", () => {
    expect(firstOfMonth("2026-07")).toBe("2026-07-01");
  });

  test("formatMonthKey spells out the month", () => {
    expect(formatMonthKey("2026-07")).toBe("July 2026");
    expect(formatMonthKey("2025-12")).toBe("December 2025");
    expect(formatMonthKey(null)).toBe("—");
    expect(formatMonthKey("bad")).toBe("bad");
  });

  test("reconciledThroughMonth returns the latest contiguous reconciled month", () => {
    const active = ["2026-05", "2026-06", "2026-07"];
    // all three reconciled → through July
    expect(reconciledThroughMonth(active, ["2026-05", "2026-06", "2026-07"])).toBe("2026-07");
    // a gap at June stops the run at May (July reconciled but not contiguous)
    expect(reconciledThroughMonth(active, ["2026-05", "2026-07"])).toBe("2026-05");
    // earliest active month unreconciled → nothing
    expect(reconciledThroughMonth(active, ["2026-06", "2026-07"])).toBeNull();
    // none reconciled → null
    expect(reconciledThroughMonth(active, [])).toBeNull();
  });
});

// The ledger search box (spec 005 US8-3) types straight into a PostgREST
// `or()` filter STRING, so the sanitizer is the boundary: a comma would start a
// second filter, a paren would close the group, and `%`/`*` are ilike wildcards
// the query adds itself. Nothing a treasurer types may become filter grammar.
describe("ledgerSearchTerm", () => {
  test("keeps an ordinary payee search intact", () => {
    expect(ledgerSearchTerm("Big Red Bus Co")).toBe("Big Red Bus Co");
  });

  test("trims and collapses whitespace", () => {
    expect(ledgerSearchTerm("  bus   deposit  ")).toBe("bus deposit");
  });

  test("blank, whitespace-only, and non-strings are no filter at all", () => {
    expect(ledgerSearchTerm("")).toBeNull();
    expect(ledgerSearchTerm("   ")).toBeNull();
    expect(ledgerSearchTerm(null)).toBeNull();
    expect(ledgerSearchTerm(undefined)).toBeNull();
    // Next hands back an array for a duplicated ?q= — not a string, no filter.
    expect(ledgerSearchTerm(["a", "b"] as unknown as string)).toBeNull();
  });

  test("strips the punctuation that would break out of the or() filter", () => {
    expect(ledgerSearchTerm("bus,memo.ilike.*")).toBe("bus memo.ilike.");
    expect(ledgerSearchTerm("a)or(b")).toBe("a or b");
    expect(ledgerSearchTerm("100%")).toBe("100");
    expect(ledgerSearchTerm(`he said "hi"`)).toBe("he said hi");
  });

  // `_` is an ilike wildcard too — it matches any ONE character. Left in, a
  // search for "check_no" quietly also matched "check-no" and "checkano", so the
  // treasurer saw entries she did not ask for and had no way to tell why.
  test("strips the single-character ilike wildcard as well", () => {
    expect(ledgerSearchTerm("check_no")).toBe("check no");
    expect(ledgerSearchTerm("_")).toBeNull();
    expect(ledgerSearchTerm("bus_co_2026")).toBe("bus co 2026");
  });

  test("punctuation-only input leaves nothing to search on", () => {
    expect(ledgerSearchTerm("%*(),_")).toBeNull();
  });

  test("caps the length — a search is a payee, not an expression", () => {
    expect(ledgerSearchTerm("x".repeat(200))).toBe("x".repeat(60));
  });
});

// ============================================================================
// Commitments — Planned → Committed → Spent → Still available (spec 006)
// ----------------------------------------------------------------------------
// The ledger records money that HAS MOVED and a budget records what was PLANNED.
// These helpers are the middle layer: what has been PROMISED. Every one of them
// is pure, and each locks down a rule that a screen would otherwise be free to
// state differently from the SQL — the arithmetic, the words, and what a figure
// we could not read is allowed to look like.
// ============================================================================

describe("stillAvailable — the headline number", () => {
  test("committed money is subtracted, not merely displayed", () => {
    // $4,000 planned, $800 spent, $3,200 already promised to a vendor. The
    // budget alone reads $3,200 available; the truth is nothing.
    expect(stillAvailable(400000, 80000, 320000)).toBe(0);
  });

  test("with nothing committed it is the old planned-minus-spent figure", () => {
    expect(stillAvailable(400000, 80000, 0)).toBe(320000);
  });

  test("it goes negative rather than clamping — an overrun is a fact", () => {
    expect(stillAvailable(400000, 380000, 50000)).toBe(-30000);
  });

  // The asymmetry (spec §2, decision D4): expected money is NOT an argument.
  // There is no way to pass it in, which is the point — you may not spend money
  // you have merely been promised.
  test("takes exactly three numbers, so expected money cannot leak into it", () => {
    expect(stillAvailable.length).toBe(3);
  });
});

describe("commitment totals and what is left on one", () => {
  test("the total is the amount plus shipping plus tax", () => {
    // Shipping and tax are separate columns because omitting them is the
    // documented top cause of an invoice arriving bigger than the PO — but the
    // committed total is all three.
    expect(
      commitmentTotalCents({
        amount_cents: 300000,
        shipping_cents: 15000,
        tax_cents: 5000,
      }),
    ).toBe(320000);
  });

  test("remaining floors at zero — a negative encumbrance would ADD to available", () => {
    expect(commitmentRemaining(320000, 305000)).toBe(15000);
    expect(commitmentRemaining(320000, 400000)).toBe(0);
  });

  test("the overspend is reported separately rather than hidden by that floor", () => {
    expect(commitmentOverspend(320000, 400000)).toBe(80000);
    expect(commitmentOverspend(320000, 305000)).toBe(0);
  });
});

describe("drawdownSentence — R3, said the same way everywhere", () => {
  test("a spending commitment reads committed / paid / still committed", () => {
    expect(drawdownSentence("spending", 320000, 305000)).toBe(
      "committed $3,200.00 · paid $3,050.00 · $150.00 still committed",
    );
  });

  test("expected money reads expected / received / still expected", () => {
    expect(drawdownSentence("expected", 50000, 20000)).toBe(
      "expected $500.00 · received $200.00 · $300.00 still expected",
    );
  });

  // R5: an overrun WARNS. The sentence still reports what was promised and what
  // moved, then says by how much reality went past it — it never rewrites the
  // promise to match the payment.
  test("an overrun is appended, never substituted", () => {
    expect(drawdownSentence("spending", 320000, 400000)).toBe(
      "committed $3,200.00 · paid $4,000.00 · $0.00 still committed · $800.00 over",
    );
  });

  test("nothing paid yet still reads as a whole sentence", () => {
    expect(drawdownSentence("spending", 320000, 0)).toBe(
      "committed $3,200.00 · paid $0.00 · $3,200.00 still committed",
    );
  });
});

describe("the lifecycle — one definition for the buttons and the writes", () => {
  const at = (
    status: string,
    stamps: Partial<CommitmentState> = {},
  ): CommitmentState => ({
    status,
    closed_at: null,
    cancelled_at: null,
    superseded_at: null,
    ...stamps,
  });

  const allowed = (row: CommitmentState): CommitmentAction[] =>
    (
      [
        "approve",
        "issue",
        "receive_partial",
        "receive_full",
        "close",
        "cancel",
        "revise",
      ] as CommitmentAction[]
    ).filter((a) => commitmentAllows(row, a));

  test("a fresh request can be approved, closed, cancelled or restated", () => {
    expect(allowed(at("requested"))).toEqual([
      "approve",
      "close",
      "cancel",
      "revise",
    ]);
  });

  test("approval is offered once and only from 'requested'", () => {
    for (const s of ["approved", "issued", "partially_received", "received"]) {
      expect(commitmentAllows(at(s), "approve")).toBe(false);
    }
  });

  test("issuing follows approval; receiving follows issuing", () => {
    expect(commitmentAllows(at("approved"), "issue")).toBe(true);
    expect(commitmentAllows(at("requested"), "issue")).toBe(false);
    expect(commitmentAllows(at("issued"), "receive_partial")).toBe(true);
    expect(commitmentAllows(at("approved"), "receive_partial")).toBe(false);
  });

  test("a part delivery can still be completed later", () => {
    expect(commitmentAllows(at("partially_received"), "receive_full")).toBe(true);
    // …but not partly received twice: it is already in that state.
    expect(commitmentAllows(at("partially_received"), "receive_partial")).toBe(
      false,
    );
  });

  // R4: closing is the explicit act that releases the remainder, so it must stay
  // available for as long as the document holds money — including a received one
  // that came in under its amount.
  test("closing and cancelling stay available all the way to 'received'", () => {
    for (const s of COMMITMENT_STATUSES.filter(
      (x) => !["closed", "cancelled", "superseded"].includes(x),
    )) {
      expect(commitmentAllows(at(s), "close"), s).toBe(true);
      expect(commitmentAllows(at(s), "cancel"), s).toBe(true);
    }
  });

  test("a closed, cancelled or superseded document makes no further moves", () => {
    expect(allowed(at("closed", { closed_at: "2026-07-01T00:00:00Z" }))).toEqual([]);
    expect(allowed(at("cancelled", { cancelled_at: "2026-07-01T00:00:00Z" }))).toEqual(
      [],
    );
    expect(
      allowed(at("superseded", { superseded_at: "2026-07-01T00:00:00Z" })),
    ).toEqual([]);
  });

  test("open and standing are the split the SQL aggregates make", () => {
    // A CLOSED document is still a fact about the season (standing) but is no
    // longer committing anything (not open). A SUPERSEDED one has been replaced
    // by its revision, and counting both would double the committed total.
    const closed = at("closed", { closed_at: "2026-07-01T00:00:00Z" });
    expect(commitmentIsStanding(closed)).toBe(true);
    expect(commitmentIsOpen(closed)).toBe(false);

    const superseded = at("superseded", { superseded_at: "2026-07-01T00:00:00Z" });
    expect(commitmentIsStanding(superseded)).toBe(false);
    expect(commitmentIsOpen(superseded)).toBe(false);
  });
});

describe("commitmentTotalsFromRow — a failed read is blank, never zero", () => {
  const full = {
    open_committed_cents: "320000",
    open_expected_cents: "50000",
    committed_gross_cents: "320000",
    drawn_cents: "0",
    open_count: "2",
    expected_count: "1",
    stale_count: "0",
    overspent_count: "0",
    after_the_fact_count: "1",
  };

  test("bigints arrive as strings from node-postgres and as numbers from PostgREST", () => {
    expect(commitmentTotalsFromRow(full)?.openCommittedCents).toBe(320000);
    expect(
      commitmentTotalsFromRow({ ...full, open_committed_cents: 320000 })
        ?.openCommittedCents,
    ).toBe(320000);
  });

  // The rule this codebase has now had to restate five times: "$0.00 committed"
  // is a number a director would act on, and a blank is not.
  test("one missing field makes the whole row null rather than a partial answer", () => {
    for (const key of Object.keys(full)) {
      const partial: Record<string, unknown> = { ...full };
      delete partial[key];
      expect(commitmentTotalsFromRow(partial), key).toBeNull();
    }
  });

  test("null, a non-object, and a garbage figure are all null", () => {
    expect(commitmentTotalsFromRow(null)).toBeNull();
    expect(commitmentTotalsFromRow("nope")).toBeNull();
    expect(commitmentTotalsFromRow({ ...full, drawn_cents: "abc" })).toBeNull();
  });
});

describe("commitmentLineTotalsFromRows / commitmentDrawdownFromRows", () => {
  test("per-line totals key by budget line", () => {
    const map = commitmentLineTotalsFromRows([
      {
        budget_line_id: "line-1",
        open_committed_cents: "320000",
        open_expected_cents: "0",
      },
    ]);
    expect(map.get("line-1")).toEqual({
      openCommittedCents: 320000,
      openExpectedCents: 0,
    });
  });

  // Unlike the ledger's line actuals there is no uncategorized bucket: a
  // commitment without a budget line cannot exist, so a row without one is a
  // broken read rather than a bucket.
  test("a per-line row with no budget line is dropped, not bucketed", () => {
    expect(
      commitmentLineTotalsFromRows([
        { budget_line_id: null, open_committed_cents: "1", open_expected_cents: "1" },
      ]).size,
    ).toBe(0);
  });

  test("per-commitment rows carry total, drawn, remaining and both flags", () => {
    const map = commitmentDrawdownFromRows([
      {
        commitment_id: "c-1",
        total_cents: "320000",
        drawn_cents: "305000",
        remaining_cents: "15000",
        is_open: true,
        is_standing: true,
      },
    ]);
    expect(map.get("c-1")).toEqual({
      totalCents: 320000,
      drawnCents: 305000,
      remainingCents: 15000,
      isOpen: true,
      isStanding: true,
    });
  });

  // An id the map does NOT carry is what makes the row render "—". If a broken
  // row were kept with zeros, a live purchase order would print "$0.00 still
  // committed".
  test("a row whose figures will not read is left out entirely", () => {
    const map = commitmentDrawdownFromRows([
      {
        commitment_id: "c-1",
        total_cents: "abc",
        drawn_cents: "0",
        remaining_cents: "0",
      },
      { total_cents: "1", drawn_cents: "0", remaining_cents: "1" },
      null,
    ]);
    expect(map.size).toBe(0);
  });

  test("a failed rpc (not an array) is an empty map, not a throw", () => {
    expect(commitmentDrawdownFromRows(null).size).toBe(0);
    expect(commitmentLineTotalsFromRows(undefined).size).toBe(0);
  });
});

describe("vocabulary (R9) — a non-technical audience reads these", () => {
  // "Encumbrance" is the accounting word and it is banned from every screen.
  // These are the strings the screens are built from, so this is where the ban
  // is enforceable.
  test("the word 'encumbrance' appears in no label the UI renders", () => {
    const strings = [
      ...Object.values(COMMITMENT_KIND_LABELS),
      ...Object.values(COMMITMENT_KIND_HEADINGS),
      ...Object.values(COMMITMENT_STATUS_LABELS),
      ...Object.values(FUNDING_SOURCE_LABELS),
      commitmentRefLabel("district", 1042),
      commitmentRefLabel("booster", 7),
      drawdownSentence("spending", 100, 50),
      drawdownSentence("expected", 100, 50),
    ];
    for (const s of strings) {
      expect(s.toLowerCase()).not.toContain("encumbr");
    }
  });

  test("a district commitment is a purchase order; a booster one is approved spending", () => {
    expect(FUNDING_SOURCE_LABELS.district).toBe("Purchase order");
    expect(FUNDING_SOURCE_LABELS.booster).toBe("Approved spending");
    expect(commitmentRefLabel("district", 1042)).toBe("PO 1042");
    expect(commitmentRefLabel("booster", 7)).toBe("Approved spending #7");
  });

  // A revision keeps the original's NUMBER — it is the same document restated,
  // which is what makes "PO 1042 · rev 2" readable to a bookkeeper who has 1042
  // in the district's own system.
  test("a revision keeps the number and says which version it is", () => {
    expect(commitmentRefLabel("district", 1042, 2)).toBe("PO 1042 · rev 2");
    expect(commitmentRefLabel("district", 1042, 0)).toBe("PO 1042");
  });

  test("every status has a plain-words label", () => {
    for (const s of COMMITMENT_STATUSES) {
      expect(COMMITMENT_STATUS_LABELS[s]).toBeTruthy();
    }
    expect(COMMITMENT_STATUS_LABELS.superseded).toBe("Replaced by a revision");
  });
});

describe("the role relaxation, mirrored from the policy (spec §4)", () => {
  // Creating a commitment is deliberately wider than every other money write,
  // because the anti-fraud value of the feature is requester ≠ approver — which
  // a treasurer-only model would DEFEAT by forcing the treasurer to raise the
  // requests she then approves.
  test("a director or admin may raise a request; only the treasurer moves one", () => {
    expect([...COMMITMENT_CREATE_ROLES].sort()).toEqual([
      "admin",
      "director",
      "treasurer",
    ]);
    expect([...TREASURY_WRITE_ROLES]).toEqual(["treasurer"]);
  });

  test("the read-only seats are not in it", () => {
    expect(COMMITMENT_CREATE_ROLES).not.toContain("board_member");
    expect(COMMITMENT_CREATE_ROLES).not.toContain("costume_manager");
  });
});

describe("parsers reject anything that is not one of the enum's own values", () => {
  test("kind and funding source", () => {
    expect(parseCommitmentKind("spending")).toBe("spending");
    expect(parseCommitmentKind("Spending")).toBeNull();
    expect(parseFundingSource("booster")).toBe("booster");
    expect(parseFundingSource("")).toBeNull();
  });

  // A form value arriving as "constructor" or "toString" must resolve to
  // nothing rather than reaching a lookup as a prototype key.
  test("a prototype key is not a value", () => {
    expect(parseCommitmentKind("constructor")).toBeNull();
    expect(parseFundingSource("toString")).toBeNull();
  });
});

// ============================================================================
// The three numbers a program sets (spec 006 D6 / T177, migration 0023)
// ----------------------------------------------------------------------------
// Two block and one nudges. What these lock is the arithmetic underneath all
// three — the boundary (above, never at), what counts toward it, and what a
// number that could not be read falls back to. Every one of them has a way of
// being wrong that reads as "no rule at all", which is the failure this feature
// cannot have.
// ============================================================================

describe("spending thresholds", () => {
  const T = COMMITMENT_THRESHOLD_DEFAULTS;

  test("the defaults are the ones the spec names: $250 · $1,000 · $500", () => {
    expect(T.secondApproverCents).toBe(25_000);
    expect(T.boardApprovalCents).toBe(100_000);
    expect(T.threeQuotesCents).toBe(50_000);
  });

  // A program that writes "$250" means a $250 order is fine. Mirrors 0023's
  // `v_total > v_second` exactly — an off-by-one here would refuse a purchase
  // the program's own policy allows.
  test("a threshold is crossed by going ABOVE it, never by meeting it", () => {
    expect(overThreshold(25_000, 25_000)).toBe(false);
    expect(overThreshold(25_001, 25_000)).toBe(true);
    expect(overThreshold(0, 25_000)).toBe(false);
  });

  // Zero is OFF, spelled as a number the program chose. Read as a threshold it
  // would mean "every purchase needs a second approver" — the opposite.
  test("zero means off, at every amount", () => {
    expect(overThreshold(1, 0)).toBe(false);
    expect(overThreshold(50_000_000, 0)).toBe(false);
  });

  test("commitmentRules answers all three at once", () => {
    expect(commitmentRules(20_000, T)).toEqual({
      needsSecondApproval: false,
      needsBoardMinutes: false,
      nudgeThreeQuotes: false,
    });
    expect(commitmentRules(60_000, T)).toEqual({
      needsSecondApproval: true,
      needsBoardMinutes: false,
      nudgeThreeQuotes: true,
    });
    expect(commitmentRules(150_000, T)).toEqual({
      needsSecondApproval: true,
      needsBoardMinutes: true,
      nudgeThreeQuotes: true,
    });
  });

  test("a program row carries its own numbers", () => {
    expect(
      commitmentThresholds({
        commitment_second_approver_cents: 50_000,
        commitment_board_approval_cents: 250_000,
        commitment_three_quotes_cents: 0,
      }),
    ).toEqual({
      secondApproverCents: 50_000,
      boardApprovalCents: 250_000,
      threeQuotesCents: 0,
    });
  });

  // bigint columns come back from PostgREST as STRINGS. A threshold read as NaN
  // and coerced to 0 would turn every rule off silently.
  test("a bigint arriving as a string is still a number", () => {
    expect(
      commitmentThresholds({
        commitment_second_approver_cents: "12345",
      }).secondApproverCents,
    ).toBe(12_345);
  });

  // THE ONE THAT MATTERS. A missing or unreadable value falls back to the
  // PROTECTIVE default, never to zero — an unread threshold must not read as
  // "no approval needed".
  test("an unreadable number falls back to the default, not to off", () => {
    expect(commitmentThresholds(null)).toEqual(T);
    expect(commitmentThresholds({})).toEqual(T);
    expect(
      commitmentThresholds({
        commitment_second_approver_cents: "not a number",
        commitment_board_approval_cents: -1,
        commitment_three_quotes_cents: null,
      }),
    ).toEqual(T);
  });
});

describe("the approval chain, read from the audit trail", () => {
  // A first approval changes no column on the commitment (0023), so
  // commitment_audit is where it lives. This is the reduction the panel reads to
  // say who has signed and who is still owed.
  test("one row per person, in the order they signed", () => {
    const chain = approvalActorsFromRows([
      { commitment_id: "c1", actor: "u1" },
      { commitment_id: "c1", actor: "u2" },
      { commitment_id: "c2", actor: "u3" },
    ]);
    expect(chain.get("c1")).toEqual(["u1", "u2"]);
    expect(chain.get("c2")).toEqual(["u3"]);
    expect(chain.get("c3")).toBeUndefined();
  });

  test("the same person twice is still one signature", () => {
    expect(
      approvalActorsFromRows([
        { commitment_id: "c1", actor: "u1" },
        { commitment_id: "c1", actor: "u1" },
      ]).get("c1"),
    ).toEqual(["u1"]);
  });

  // A service-role write has no auth.uid() and so no actor. It is not a person
  // and must never count toward a signature.
  test("a row with no actor is not a signature", () => {
    expect(
      approvalActorsFromRows([
        { commitment_id: "c1", actor: null },
        { commitment_id: "c1" },
      ]).size,
    ).toBe(0);
  });

  test("a failed read is an empty chain, not a crash", () => {
    expect(approvalActorsFromRows(null).size).toBe(0);
    expect(approvalActorsFromRows("nope").size).toBe(0);
    expect(approvalActorsFromRows([null, 7, "x"]).size).toBe(0);
  });
});

describe("who may give which approval", () => {
  // The SECOND stated relaxation: a board member — read-only everywhere else —
  // may give the FIRST of two approvals, because in a booster program the second
  // signature IS the board. It can never approve anything on its own: the
  // completing approval is still the treasurer's.
  test("the first of two admits the board; the one that finishes it does not", () => {
    expect([...COMMITMENT_APPROVE_ROLES].sort()).toEqual([
      "admin",
      "board_member",
      "director",
      "treasurer",
    ]);
    expect([...TREASURY_WRITE_ROLES]).toEqual(["treasurer"]);
    expect(COMMITMENT_APPROVE_ROLES).not.toContain("costume_manager");
  });
});
