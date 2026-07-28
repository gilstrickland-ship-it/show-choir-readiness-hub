// ============================================================================
// ledger.spec.ts — void-only ledger + append-only audit (Constitution V)
// ----------------------------------------------------------------------------
// Money is tracked, never mutated. The enforce_ledger_void_only trigger allows
// exactly one kind of UPDATE — flipping a live entry to voided — and forbids
// editing any financial field or un-voiding. ledger_audit is append-only: it
// has insert + select policies but no update/delete, so mutations touch zero
// rows. All exercised as the treasurer (the only role that may write money).
// ============================================================================

import { describe, test, expect } from 'vitest';
import { A, B, SUPPORT_USER } from './fixtures';
import { asUser, asAnon, raw, rlsSkipped, RLS_DENIED } from './harness';
import {
  summarizeSeasonLedger,
  UNCATEGORIZED_KEY,
  type LedgerEntryRow,
} from '@/lib/treasury';

const treasurer = () => asUser(A.treasurer);
const board = () => asUser(A.board);
const costume = () => asUser(A.costume);
const director = () => asUser(A.director);
const otherTreasurer = () => asUser(B.treasurer);

describe.skipIf(rlsSkipped())('ledger void-only enforcement', () => {
  test('editing amount_cents is rejected (entries are immutable)', async () => {
    const err = await treasurer().expectDenied(
      `update ledger_entries set amount_cents = 99999 where id = $1`,
      [A.ledgerLive],
    );
    expect(err.message).toMatch(/immutable/i);
  });

  test('voiding a live entry is allowed', async () => {
    const ok = await treasurer().allows(
      `update ledger_entries set voided_at = now(), voided_by = $2, void_reason = 'correction' where id = $1`,
      [A.ledgerLive, A.treasurer],
    );
    expect(ok).toBe(true);
  });

  test('un-voiding an entry is rejected', async () => {
    const err = await treasurer().expectDenied(
      `update ledger_entries set voided_at = null where id = $1`,
      [A.ledgerVoided],
    );
    expect(err.message).toMatch(/un-voided/i);
  });
});

describe.skipIf(rlsSkipped())('ledger_audit is append-only', () => {
  test('treasurer may insert an audit row', async () => {
    const ok = await treasurer().allows(
      `insert into ledger_audit (program_id, entry_id, action, actor) values ($1, $2, 'update', $3)`,
      [A.program, A.ledgerLive, A.treasurer],
    );
    expect(ok).toBe(true);
  });

  test('updating an audit row mutates nothing (no update policy)', async () => {
    const res = await treasurer().query(`update ledger_audit set action = 'void' where id = $1`, [
      A.ledgerAudit,
    ]);
    expect(res.rowCount).toBe(0);
  });

  test('deleting an audit row removes nothing (no delete policy)', async () => {
    const res = await treasurer().query(`delete from ledger_audit where id = $1`, [A.ledgerAudit]);
    expect(res.rowCount).toBe(0);
  });
});

// ============================================================================
// Migration 0019 — the aggregate READ functions
// ----------------------------------------------------------------------------
// Every money total is now one SQL row instead of a JavaScript sum over a
// fetched list, because PostgREST truncates a response at max_rows and a
// truncated balance is a wrong balance presented as a right one. These are
// SECURITY DEFINER, so each one has to re-state its own gate: the treasury read
// matrix (director/admin/treasurer/board_member — never costume_manager), and a
// hard refusal for any program the caller is not in.
// ============================================================================

describe.skipIf(rlsSkipped())('0019 read functions — role + tenant gates', () => {
  const totals = `select * from public.ledger_season_totals($1, $2)`;
  const lineActuals = `select * from public.ledger_line_actuals($1, $2)`;
  const balances = `select * from public.ledger_running_balance($1, $2, $3::uuid[])`;

  test('treasurer reads season totals, and they count the seeded live rows', async () => {
    const res = await treasurer().query<{
      out_cents: string;
      uncategorized_count: string;
      uncategorized_cents: string;
      months: string[];
    }>(totals, [A.program, A.seasonActive]);
    expect(res.rowCount).toBe(1);
    // 12500 (on a line) + 7500 (uncategorized); the voided 9900 'in' never counts.
    expect(Number(res.rows[0].out_cents)).toBe(20000);
    expect(Number(res.rows[0].uncategorized_count)).toBe(1);
    expect(Number(res.rows[0].uncategorized_cents)).toBe(7500);
    expect(res.rows[0].months.length).toBeGreaterThan(0);
  });

  test('board member reads them too — full money transparency is the control', async () => {
    expect(await board().count(totals, [A.program, A.seasonActive])).toBe(1);
    expect(await board().allows(lineActuals, [A.program, A.seasonActive])).toBe(true);
  });

  test('director reads them', async () => {
    expect(await director().count(totals, [A.program, A.seasonActive])).toBe(1);
  });

  test('costume_manager is refused — money is not that seat', async () => {
    const err = await costume().expectDenied(totals, [A.program, A.seasonActive]);
    expect(err.code).toBe(RLS_DENIED);
  });

  test("another program's treasurer cannot read this program's totals", async () => {
    const err = await otherTreasurer().expectDenied(totals, [A.program, A.seasonActive]);
    expect(err.code).toBe(RLS_DENIED);
    const err2 = await otherTreasurer().expectDenied(lineActuals, [A.program, A.seasonActive]);
    expect(err2.code).toBe(RLS_DENIED);
  });

  test('anon is refused', async () => {
    const err = await asAnon().expectDenied(totals, [A.program, A.seasonActive]);
    expect(err.code).toBe(RLS_DENIED);
  });

  // An Octv support user has a time-boxed, consent-gated READ of a program
  // (0004). The money page reads its totals through these functions now, so a
  // definer function that only checked has_role would have silently revoked the
  // support view — support would see a ledger with no balance above it.
  test('support WITH consent (program A) reads the totals', async () => {
    expect(await asUser(SUPPORT_USER).count(totals, [A.program, A.seasonActive])).toBe(1);
  });

  test('support WITHOUT consent (program B) is refused', async () => {
    const err = await asUser(SUPPORT_USER).expectDenied(totals, [B.program, B.seasonActive]);
    expect(err.code).toBe(RLS_DENIED);
  });

  test('support never writes money, consent or not', async () => {
    const err = await asUser(SUPPORT_USER).expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null)`,
      [A.program, A.seasonActive],
    );
    expect(err.code).toBe(RLS_DENIED);
  });

  test('line actuals group by line and keep the uncategorized bucket separate', async () => {
    const res = await treasurer().query<{
      budget_line_id: string | null;
      out_cents: string;
    }>(lineActuals, [A.program, A.seasonActive]);
    const onLine = res.rows.find((r) => r.budget_line_id === A.budgetLine);
    const uncat = res.rows.find((r) => r.budget_line_id === null);
    expect(Number(onLine?.out_cents)).toBe(12500);
    expect(Number(uncat?.out_cents)).toBe(7500);
  });

  test('running balance is the season total as of that entry, voids excluded', async () => {
    const res = await treasurer().query<{ entry_id: string; balance_cents: string }>(balances, [
      A.program,
      A.seasonActive,
      [A.ledgerLive, A.ledgerUncategorized],
    ]);
    expect(res.rowCount).toBe(2);
    const last = res.rows
      .map((r) => Number(r.balance_cents))
      .sort((x, y) => x - y)[0];
    // Two outflows totalling 20000 → the later row's balance is −20000.
    expect(last).toBe(-20000);
  });

  test("a cross-program entry id returns nothing rather than another tenant's balance", async () => {
    const res = await treasurer().query(balances, [
      A.program,
      A.seasonActive,
      [B.ledgerLive],
    ]);
    expect(res.rowCount).toBe(0);
  });
});

// ============================================================================
// Migration 0019 — the WRITE functions
// ----------------------------------------------------------------------------
// The defect these exist for: void-then-insert as two PostgREST calls is not a
// transaction, so a failure between them voided real money out of the balance
// with no replacement and no way back (the trigger forbids un-voiding). Each
// function writes the entry AND its audit row in one transaction, and none of
// them may become a way around the void-only rule or around tenancy.
// ============================================================================

describe.skipIf(rlsSkipped())('0019 write functions — atomic, treasurer-only, in-tenant', () => {
  test('add_ledger_entry writes the entry AND its create audit row together', async () => {
    const { entry, audit } = await treasurer().tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `select public.add_ledger_entry($1, $2, current_date, 'out', 4200, null, null, null, 'bus deposit', 'Bus Co', null) as id`,
        [A.program, A.seasonActive],
      );
      const id = ins.rows[0].id;
      const entryRes = await c.query(
        `select amount_cents, memo from ledger_entries where id = $1`,
        [id],
      );
      const auditRes = await c.query(
        `select action from ledger_audit where entry_id = $1`,
        [id],
      );
      return { entry: entryRes.rows[0], audit: auditRes.rows };
    });
    expect(Number(entry.amount_cents)).toBe(4200);
    expect(audit).toEqual([{ action: 'create' }]);
  });

  test('board member cannot add an entry through the function', async () => {
    const err = await board().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null)`,
      [A.program, A.seasonActive],
    );
    expect(err.code).toBe(RLS_DENIED);
  });

  test("another program's treasurer cannot add an entry to this program", async () => {
    const err = await otherTreasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null)`,
      [A.program, A.seasonActive],
    );
    expect(err.code).toBe(RLS_DENIED);
  });

  test("a budget line from ANOTHER season cannot be booked onto this season's entry", async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, $3, null, null, null, null, null)`,
      [A.program, A.seasonActive, A.budgetLineArchived],
    );
    expect(err.message).toMatch(/season/i);
  });

  test("another program's budget line is refused outright", async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, $3, null, null, null, null, null)`,
      [A.program, A.seasonActive, B.budgetLine],
    );
    expect(err.message).toMatch(/budget line/i);
  });

  test('an archived season is refused (the RLS insert rule, restated)', async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null)`,
      [A.program, A.seasonArchived],
    );
    expect(err.message).toMatch(/archived/i);
  });

  test('a zero or negative amount is refused', async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 0, null, null, null, null, null, null)`,
      [A.program, A.seasonActive],
    );
    expect(err.message).toMatch(/amount/i);
  });

  test('void_ledger_entry voids and audits in one call', async () => {
    const { ok, voided, audit } = await treasurer().tx(async (c) => {
      const res = await c.query<{ ok: boolean }>(
        `select public.void_ledger_entry($1, $2, 'wrong amount') as ok`,
        [A.ledgerLive, A.program],
      );
      const row = await c.query(
        `select voided_at, void_reason, amount_cents from ledger_entries where id = $1`,
        [A.ledgerLive],
      );
      const aud = await c.query(
        `select action from ledger_audit where entry_id = $1 and action = 'void'`,
        [A.ledgerLive],
      );
      return { ok: res.rows[0].ok, voided: row.rows[0], audit: aud.rows.length };
    });
    expect(ok).toBe(true);
    expect(voided.voided_at).not.toBeNull();
    expect(voided.void_reason).toBe('wrong amount');
    // The money itself is untouched — voiding is the ONLY permitted mutation.
    expect(Number(voided.amount_cents)).toBe(12500);
    expect(audit).toBe(1);
  });

  test('an already-voided entry returns false and writes NO audit row', async () => {
    const { ok, auditCount } = await treasurer().tx(async (c) => {
      const before = await c.query(`select count(*)::int as n from ledger_audit where entry_id = $1`, [
        A.ledgerVoided,
      ]);
      const res = await c.query<{ ok: boolean }>(
        `select public.void_ledger_entry($1, $2, 'again') as ok`,
        [A.ledgerVoided, A.program],
      );
      const after = await c.query(`select count(*)::int as n from ledger_audit where entry_id = $1`, [
        A.ledgerVoided,
      ]);
      return { ok: res.rows[0].ok, auditCount: after.rows[0].n - before.rows[0].n };
    });
    expect(ok).toBe(false);
    expect(auditCount).toBe(0);
  });

  test("another program's entry cannot be voided, and nothing is written", async () => {
    // The definer function is asked to void B's entry while claiming A. It must
    // refuse without acting: the row is scoped by (id, program_id), so the
    // lookup finds nothing and the call returns false having written neither the
    // void nor an audit row. Ground truth is read with RLS bypassed, because A's
    // treasurer cannot see B's rows at all — which is the point.
    const res = await treasurer().query<{ ok: boolean }>(
      `select public.void_ledger_entry($1, $2, 'not mine') as ok`,
      [B.ledgerLive, A.program],
    );
    expect(res.rows[0].ok).toBe(false);
    const truth = await raw<{ voided_at: string | null }>(
      `select voided_at from ledger_entries where id = $1`,
      [B.ledgerLive],
    );
    expect(truth.rows[0].voided_at).toBeNull();
  });

  test('a void with no reason is refused', async () => {
    const err = await treasurer().expectDenied(
      `select public.void_ledger_entry($1, $2, '   ')`,
      [A.ledgerLive, A.program],
    );
    expect(err.message).toMatch(/reason/i);
  });

  test('categorize_ledger_entry moves the amount onto the line, atomically', async () => {
    const result = await treasurer().tx(async (c) => {
      const res = await c.query<{ id: string }>(
        `select public.categorize_ledger_entry($1, $2, $3) as id`,
        [A.ledgerUncategorized, A.program, A.budgetLine],
      );
      const newId = res.rows[0].id;
      const original = await c.query(
        `select voided_at, amount_cents, budget_line_id from ledger_entries where id = $1`,
        [A.ledgerUncategorized],
      );
      const replacement = await c.query(
        `select amount_cents, budget_line_id, counterparty, memo, season_id
           from ledger_entries where id = $1`,
        [newId],
      );
      const audit = await c.query<{ action: string }>(
        `select action from ledger_audit where entry_id in ($1, $2) order by action`,
        [A.ledgerUncategorized, newId],
      );
      return {
        newId,
        original: original.rows[0],
        replacement: replacement.rows[0],
        audit: audit.rows.map((r) => r.action),
      };
    });
    expect(result.newId).toBeTruthy();
    // Original: voided, but its money is byte-for-byte what it was.
    expect(result.original.voided_at).not.toBeNull();
    expect(Number(result.original.amount_cents)).toBe(7500);
    expect(result.original.budget_line_id).toBeNull();
    // Replacement: same money, now on the line, same everything else.
    expect(Number(result.replacement.amount_cents)).toBe(7500);
    expect(result.replacement.budget_line_id).toBe(A.budgetLine);
    expect(result.replacement.counterparty).toBe('Bus Co');
    expect(result.replacement.season_id).toBe(A.seasonActive);
    // Both halves are audited — the void of the old and the create of the new.
    expect(result.audit).toEqual(['create', 'void']);
  });

  test('the net balance is unchanged by filing an entry (money moves, none appears or vanishes)', async () => {
    const { before, after } = await treasurer().tx(async (c) => {
      const read = async () => {
        const r = await c.query<{ net_cents: string }>(
          `select net_cents from public.ledger_season_totals($1, $2)`,
          [A.program, A.seasonActive],
        );
        return Number(r.rows[0].net_cents);
      };
      const b = await read();
      await c.query(`select public.categorize_ledger_entry($1, $2, $3)`, [
        A.ledgerUncategorized,
        A.program,
        A.budgetLine,
      ]);
      return { before: b, after: await read() };
    });
    expect(after).toBe(before);
  });

  test('a cross-program entry id files nothing and writes nothing', async () => {
    const res = await treasurer().query<{ id: string | null }>(
      `select public.categorize_ledger_entry($1, $2, $3) as id`,
      [B.ledgerUncategorized, A.program, A.budgetLine],
    );
    expect(res.rows[0].id).toBeNull();
    const truth = await raw<{ voided_at: string | null; budget_line_id: string | null }>(
      `select voided_at, budget_line_id from ledger_entries where id = $1`,
      [B.ledgerUncategorized],
    );
    expect(truth.rows[0].voided_at).toBeNull();
    expect(truth.rows[0].budget_line_id).toBeNull();
  });

  test('an entry that is already on a line files nothing', async () => {
    const res = await treasurer().query<{ id: string | null }>(
      `select public.categorize_ledger_entry($1, $2, $3) as id`,
      [A.ledgerLive, A.program, A.budgetLine],
    );
    expect(res.rows[0].id).toBeNull();
  });

  test('board member cannot categorize', async () => {
    const err = await board().expectDenied(
      `select public.categorize_ledger_entry($1, $2, $3)`,
      [A.ledgerUncategorized, A.program, A.budgetLine],
    );
    expect(err.code).toBe(RLS_DENIED);
  });

  test("a line from another program is refused", async () => {
    const err = await treasurer().expectDenied(
      `select public.categorize_ledger_entry($1, $2, $3)`,
      [A.ledgerUncategorized, A.program, B.budgetLine],
    );
    expect(err.message).toMatch(/budget line/i);
  });

  test('the functions never un-void: the void-only trigger still governs them', async () => {
    // Belt and braces on the rule the whole design rests on — a definer function
    // is not an exemption from it.
    const err = await treasurer().expectDenied(
      `update ledger_entries set voided_at = null where id = $1`,
      [A.ledgerVoided],
    );
    expect(err.message).toMatch(/un-voided/i);
  });
});

// ============================================================================
// The board-snapshot PDF agrees with the board-snapshot page (review F1)
// ----------------------------------------------------------------------------
// One money read in the app cannot call the 0019 aggregates: the board-snapshot
// PDF is built by the export-all runner and the share-link routes on a
// SERVICE-ROLE client, where auth.uid() is null and private.ledger_may_read
// therefore refuses. Loosening that guard to admit a service-role caller would
// carve an exception into a fiduciary read control, so the PDF pages the raw
// rows instead and reduces them in TypeScript (lib/treasury summarizeSeasonLedger).
//
// That is only safe if the TypeScript reduction IS the SQL's definition. These
// run BOTH over the same rows, in real Postgres, past PostgREST's 1000-row cap —
// the point at which the old un-paginated fetch started printing a smaller
// number to the board than the Reports page showed on screen. Everything happens
// inside a rolled-back transaction, so no other spec sees these rows.
// ============================================================================

describe.skipIf(rlsSkipped())('board snapshot: the JS reduction equals the SQL aggregates', () => {
  const CAP = 1000; // PostgREST max_rows — what the un-paginated fetch stopped at

  // Read every live row of the season the way the PDF's paged fetch does.
  // bigint and date come back as strings from node-postgres, which is exactly
  // the shape the helper is written to accept.
  const LIVE_ROWS = `
    select direction,
           amount_cents::text as amount_cents,
           budget_line_id,
           to_char(entry_date, 'YYYY-MM-DD') as entry_date,
           voided_at
      from ledger_entries
     where program_id = $1 and season_id = $2 and voided_at is null
     order by id`;

  // 1,200 entries in one statement: a mix of directions, of dates across several
  // months, and one in five deliberately left uncategorized.
  const SEED = `
    insert into ledger_entries
      (program_id, season_id, entry_date, direction, amount_cents, budget_line_id, entered_by)
    select $1, $2,
           date '2026-01-01' + ((g * 7) % 200),
           (case when g % 3 = 0 then 'in' else 'out' end)::ledger_entry_direction,
           100 + g,
           (case when g % 5 = 0 then null else $3::uuid end),
           $4
      from generate_series(1, 1200) g`;

  test('every total matches, and the truncated read would NOT have', async () => {
    const { sql, rows } = await treasurer().tx(async (c) => {
      await c.query(SEED, [A.program, A.seasonActive, A.budgetLine, A.treasurer]);
      const totals = await c.query<{
        in_cents: string;
        out_cents: string;
        net_cents: string;
        entry_count: string;
        uncategorized_count: string;
        uncategorized_cents: string;
        months: string[];
      }>(`select * from public.ledger_season_totals($1, $2)`, [A.program, A.seasonActive]);
      const live = await c.query<LedgerEntryRow>(LIVE_ROWS, [A.program, A.seasonActive]);
      return { sql: totals.rows[0], rows: live.rows };
    });

    // Past the cap on purpose: below it there is no defect to catch.
    expect(rows.length).toBeGreaterThan(CAP);

    const js = summarizeSeasonLedger(rows).totals;
    expect(js.inCents).toBe(Number(sql.in_cents));
    expect(js.outCents).toBe(Number(sql.out_cents));
    expect(js.netCents).toBe(Number(sql.net_cents));
    expect(js.entryCount).toBe(Number(sql.entry_count));
    expect(js.uncategorizedCount).toBe(Number(sql.uncategorized_count));
    expect(js.uncategorizedCents).toBe(Number(sql.uncategorized_cents));
    expect(js.months).toEqual([...sql.months]);

    // The defect itself, pinned: the same reduction over only the first page —
    // which is all an un-paginated PostgREST read ever returned — reports a
    // balance the board would have been read as if it were the whole season.
    const truncated = summarizeSeasonLedger(rows.slice(0, CAP)).totals;
    expect(truncated.netCents).not.toBe(js.netCents);
    expect(truncated.entryCount).toBe(CAP);
  });

  test('per-line actuals match ledger_line_actuals, uncategorized bucket included', async () => {
    const { sql, rows } = await treasurer().tx(async (c) => {
      await c.query(SEED, [A.program, A.seasonActive, A.budgetLine, A.treasurer]);
      const actuals = await c.query<{
        budget_line_id: string | null;
        in_cents: string;
        out_cents: string;
      }>(`select * from public.ledger_line_actuals($1, $2)`, [A.program, A.seasonActive]);
      const live = await c.query<LedgerEntryRow>(LIVE_ROWS, [A.program, A.seasonActive]);
      return { sql: actuals.rows, rows: live.rows };
    });

    const js = summarizeSeasonLedger(rows).byLine;
    expect(js.size).toBe(sql.length);
    for (const row of sql) {
      const mine = js.get(row.budget_line_id ?? UNCATEGORIZED_KEY);
      expect(mine).toBeDefined();
      expect(mine?.inCents).toBe(Number(row.in_cents));
      expect(mine?.outCents).toBe(Number(row.out_cents));
    }
  });
});
