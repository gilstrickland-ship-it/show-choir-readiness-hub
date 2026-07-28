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
  actualForLine,
  sumActuals,
  monthKeyForDate,
  firstOfMonth,
  formatMonthKey,
  listMonthsWithEntries,
  reconciledThroughMonth,
  type LedgerAmountRow,
  type LedgerMonthRow,
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

describe("sumActuals / actualForLine", () => {
  const rows: LedgerAmountRow[] = [
    { direction: "in", amount_cents: 10000, voided_at: null, budget_line_id: "L1" },
    { direction: "out", amount_cents: 4000, voided_at: null, budget_line_id: "L2" },
    { direction: "out", amount_cents: 2500, voided_at: null, budget_line_id: null },
    // voided rows never count
    { direction: "in", amount_cents: 99999, voided_at: "2026-01-01", budget_line_id: "L1" },
  ];

  test("sumActuals excludes voided", () => {
    expect(sumActuals(rows)).toEqual({
      inCents: 10000,
      outCents: 6500,
      netCents: 3500,
    });
  });

  test("actualForLine matches line + direction, skips voided", () => {
    expect(actualForLine("L1", "income", rows)).toBe(10000);
    expect(actualForLine("L2", "expense", rows)).toBe(4000);
    // wrong direction contributes nothing
    expect(actualForLine("L1", "expense", rows)).toBe(0);
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

  test("listMonthsWithEntries: distinct months of non-voided entries, newest first", () => {
    const rows: LedgerMonthRow[] = [
      { entry_date: "2026-05-03", voided_at: null },
      { entry_date: "2026-05-20", voided_at: null }, // same month, dedup
      { entry_date: "2026-07-01", voided_at: null },
      { entry_date: "2026-06-15", voided_at: "2026-06-16" }, // voided → excluded
    ];
    expect(listMonthsWithEntries(rows)).toEqual(["2026-07", "2026-05"]);
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

  test("punctuation-only input leaves nothing to search on", () => {
    expect(ledgerSearchTerm("%*(),")).toBeNull();
  });

  test("caps the length — a search is a payee, not an expression", () => {
    expect(ledgerSearchTerm("x".repeat(200))).toBe("x".repeat(60));
  });
});
