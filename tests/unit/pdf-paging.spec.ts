// ============================================================================
// Unit tests — the derived documents read WHOLE lists (money-integrity review F1)
// ----------------------------------------------------------------------------
// PostgREST caps a response at `max_rows` (1000) and says nothing when it
// truncates. Every list in lib/pdf/queries.ts becomes a printed document, so a
// silent prefix is the worst available failure: it looks complete. The board
// snapshot is the sharpest case — it is a money document read to a board, and it
// used to sum an unbounded fetch in JavaScript, so past 1000 entries it printed
// a smaller number than the Reports page did.
//
// These drive fetchAllRows against a fake that behaves exactly like a capped
// PostgREST: it honours .range() and never returns more than PAGE_SIZE rows.
// ============================================================================

import { describe, test, expect } from "vitest";
import { fetchAllRows } from "@/lib/pdf/queries";

const CAP = 1000;

interface Row {
  id: number;
}

// A source of `total` rows that answers .range(from, to) the way PostgREST does:
// inclusive bounds, never more than the server cap, and no signal at all that
// there is more behind it. `calls` records the ranges asked for.
function cappedTable(total: number, calls: [number, number][] = []) {
  return {
    calls,
    build() {
      return {
        range(from: number, to: number) {
          calls.push([from, to]);
          const end = Math.min(to, from + CAP - 1, total - 1);
          const rows: Row[] = [];
          for (let i = from; i <= end; i++) rows.push({ id: i });
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

describe("fetchAllRows", () => {
  test("a list that fits in one page costs exactly one request", async () => {
    const t = cappedTable(12);
    const rows = await fetchAllRows<Row>(() => t.build(), "small list");
    expect(rows).toHaveLength(12);
    expect(t.calls).toEqual([[0, 999]]);
  });

  // The defect, in one assertion: 2,500 ledger entries used to arrive as 1,000.
  test("a list past the row cap comes back whole, in order, with no gaps", async () => {
    const t = cappedTable(2500);
    const rows = await fetchAllRows<Row>(() => t.build(), "big list");
    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  // A read whose LAST page is exactly full is indistinguishable from a truncated
  // one until you ask again and get nothing back. Stopping a page early here is
  // how a total ends up one page short at every round thousand.
  test("an exactly-full final page is confirmed with one more request", async () => {
    const t = cappedTable(2000);
    const rows = await fetchAllRows<Row>(() => t.build(), "exact multiple");
    expect(rows).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
    expect(t.calls[2]).toEqual([2000, 2999]);
  });

  test("an empty table is one request and no rows", async () => {
    const t = cappedTable(0);
    expect(await fetchAllRows<Row>(() => t.build(), "empty")).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  // A read error stops the document. Rendering a board snapshot from the pages
  // that happened to arrive is the failure this whole change exists to remove.
  test("a read error throws rather than returning the pages that worked", async () => {
    let page = 0;
    await expect(
      fetchAllRows<Row>(
        () => ({
          range: (from: number) => {
            page += 1;
            if (page === 2) {
              return Promise.resolve({ data: null, error: { message: "boom" } });
            }
            return Promise.resolve({
              data: Array.from({ length: CAP }, (_, i) => ({ id: from + i })),
              error: null,
            });
          },
        }),
        "board snapshot ledger",
      ),
    ).rejects.toThrow(/board snapshot ledger: boom/);
  });

  // The runaway guard. A query that never returns a short page is a bug in the
  // query, and it must fail loudly — looping forever, or quietly handing back
  // the first two million rows as if they were all of them, are both worse.
  test("a list that never ends is refused, loudly, rather than truncated", async () => {
    await expect(
      fetchAllRows<Row>(
        () => ({
          range: (from: number) =>
            Promise.resolve({
              data: Array.from({ length: CAP }, (_, i) => ({ id: from + i })),
              error: null,
            }),
        }),
        "endless list",
      ),
    ).rejects.toThrow(/endless list: more than 2000000 rows/);
  });

  test("a response that is not a list of rows is refused", async () => {
    await expect(
      fetchAllRows<Row>(
        () => ({
          range: () => Promise.resolve({ data: { oops: true }, error: null }),
        }),
        "odd response",
      ),
    ).rejects.toThrow(/odd response: expected a list of rows/);
  });
});
