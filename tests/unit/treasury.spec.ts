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
