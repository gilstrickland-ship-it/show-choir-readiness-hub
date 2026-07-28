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
import { asUser, asAnon, raw, rlsSkipped, RLS_DENIED, type RlsError } from './harness';
import { postgrestOver } from './postgrest';
import { loadBoardSnapshot } from '@/lib/pdf/queries';
import {
  summarizeSeasonLedger,
  lineActualsFromRows,
  actualForDirection,
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

  // 0020: the single `false` these two used to share said the same thing about
  // a no-op and a tenancy mistake, so the UI could only offer one sentence for
  // both. Each raises its own code now, and NEITHER writes anything — which is
  // the property that actually matters and is asserted below either way.
  test('an already-voided entry raises OC003 and writes NO audit row', async () => {
    const { code, auditCount } = await treasurer().tx(async (c) => {
      const before = await c.query(`select count(*)::int as n from ledger_audit where entry_id = $1`, [
        A.ledgerVoided,
      ]);
      let raised = '';
      // A raised exception aborts the transaction, so the follow-up count needs
      // a savepoint to roll back to. NOT `rollback; begin` — `set local role`
      // and the auth GUC are LOCAL to the transaction and would be lost with it,
      // which would silently continue the test as a superuser with no auth.uid().
      await c.query('savepoint before_void');
      try {
        await c.query(`select public.void_ledger_entry($1, $2, 'again')`, [
          A.ledgerVoided,
          A.program,
        ]);
      } catch (err) {
        raised = (err as RlsError).code ?? '';
        await c.query('rollback to savepoint before_void');
      }
      const after = await c.query(`select count(*)::int as n from ledger_audit where entry_id = $1`, [
        A.ledgerVoided,
      ]);
      return { code: raised, auditCount: after.rows[0].n - before.rows[0].n };
    });
    expect(code).toBe('OC003');
    expect(auditCount).toBe(0);
  });

  test("another program's entry cannot be voided, and nothing is written", async () => {
    // The definer function is asked to void B's entry while claiming A. It must
    // refuse without acting: the row is scoped by (id, program_id), so the
    // lookup finds nothing and the call raises "not this program's" having
    // written neither the void nor an audit row. Ground truth is read with RLS
    // bypassed, because A's treasurer cannot see B's rows at all — the point.
    const err = await treasurer().expectDenied(
      `select public.void_ledger_entry($1, $2, 'not mine')`,
      [B.ledgerLive, A.program],
    );
    expect(err.code).toBe('OC001');
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
    const err = await treasurer().expectDenied(
      `select public.categorize_ledger_entry($1, $2, $3)`,
      [B.ledgerUncategorized, A.program, A.budgetLine],
    );
    expect(err.code).toBe('OC001');
    const truth = await raw<{ voided_at: string | null; budget_line_id: string | null }>(
      `select voided_at, budget_line_id from ledger_entries where id = $1`,
      [B.ledgerUncategorized],
    );
    expect(truth.rows[0].voided_at).toBeNull();
    expect(truth.rows[0].budget_line_id).toBeNull();
  });

  test('an entry that is already on a line reads as already filed', async () => {
    const err = await treasurer().expectDenied(
      `select public.categorize_ledger_entry($1, $2, $3)`,
      [A.ledgerLive, A.program, A.budgetLine],
    );
    expect(err.code).toBe('OC002');
  });

  // THE DOUBLE SUBMIT, WHICH IS THE WHOLE REASON 0020 EXISTS. Filing is a void
  // plus a replacement, so pressing "Save the line" twice sends the ORIGINAL id
  // the second time and finds it voided. That used to be indistinguishable from
  // "not this program's" and from a hand-void — all three returned NULL, and the
  // UI said "Nothing changed — the entry is still there, uncategorized" about a
  // filing that had just worked. The replacement's audit row records what it
  // replaced, so the second call can say "already filed" as a fact.
  test('filing the same entry twice says ALREADY FILED, not "nothing changed"', async () => {
    const { firstId, secondCode, replacements } = await treasurer().tx(async (c) => {
      const first = await c.query<{ id: string }>(
        `select public.categorize_ledger_entry($1, $2, $3) as id`,
        [A.ledgerUncategorized, A.program, A.budgetLine],
      );
      // The second press. A savepoint, not `rollback; begin` — `set local role`
      // and the auth GUC belong to the transaction, and losing them would run
      // the rest of this as a superuser with no auth.uid(). Rolling back to it
      // also leaves the FIRST filing standing, which is what makes the
      // replacement count below meaningful.
      let code = '';
      await c.query('savepoint before_resubmit');
      try {
        await c.query(`select public.categorize_ledger_entry($1, $2, $3)`, [
          A.ledgerUncategorized,
          A.program,
          A.budgetLine,
        ]);
      } catch (err) {
        code = (err as RlsError).code ?? '';
        await c.query('rollback to savepoint before_resubmit');
      }
      const n = await c.query<{ n: number }>(
        `select count(*)::int as n from ledger_audit
          where program_id = $1 and action = 'create' and diff ->> 'replaces' = $2::text`,
        [A.program, A.ledgerUncategorized],
      );
      return {
        firstId: first.rows[0].id,
        secondCode: code,
        replacements: n.rows[0].n,
      };
    });
    expect(firstId).toBeTruthy();
    expect(secondCode).toBe('OC002');
    // One original, one replacement — never two.
    expect(replacements).toBe(1);
  });

  test('an entry voided by hand has nothing to file, and says so distinctly', async () => {
    const err = await treasurer().expectDenied(
      `select public.categorize_ledger_entry($1, $2, $3)`,
      [A.ledgerVoided, A.program, A.budgetLine],
    );
    expect(err.code).toBe('OC003');
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
    expect(err.code).toBe('OC012');
    expect(err.message).toMatch(/budget line/i);
  });

  // 0020 §1: five distinct guards used to raise one code, so the ledger could
  // only ever answer "check the amount (e.g. 1,234.56), direction, and date" —
  // including when what was actually wrong was a competition from last season.
  test('add_ledger_entry names WHICH thing it refused', async () => {
    const cases: [string, unknown[], string][] = [
      [
        'a zero amount',
        [A.program, A.seasonActive, '2026-02-01', 'in', 0, null, null, null],
        'OC010',
      ],
      [
        "another program's season",
        [A.program, B.seasonActive, '2026-02-01', 'in', 500, null, null, null],
        'OC011',
      ],
      [
        "another program's budget line",
        [A.program, A.seasonActive, '2026-02-01', 'in', 500, B.budgetLine, null, null],
        'OC012',
      ],
      [
        "another program's competition",
        [A.program, A.seasonActive, '2026-02-01', 'in', 500, null, B.competition, null],
        'OC013',
      ],
    ];
    for (const [what, args, code] of cases) {
      const err = await treasurer().expectDenied(
        `select public.add_ledger_entry($1, $2, $3::date, $4::ledger_entry_direction, $5::bigint, $6::uuid, $7::uuid, $8::uuid)`,
        args,
      );
      expect(err.code, what).toBe(code);
    }
  });

  // The 0019 §8 / 0020 §4 revokes, asserted where they can actually fail. The
  // harness used to re-grant EXECUTE on every public function to `anon` AFTER
  // the migrations ran, so these functions were reachable at
  // /rest/v1/rpc/<name> by an unauthenticated caller throughout the suite and
  // every one of these assertions would have passed with the revokes deleted.
  test('the money functions are not executable by anon or PUBLIC', async () => {
    const SIGNATURES = [
      'public.ledger_season_totals(uuid, uuid)',
      'public.ledger_line_actuals(uuid, uuid, uuid, uuid)',
      'public.ledger_running_balance(uuid, uuid, uuid[])',
      // Twelve parameters since 0021: the last one is the commitment a payment
      // draws down (spec 006 R3). The eleven-parameter version was DROPPED
      // rather than overloaded — PostgREST calls by name, and two candidates
      // differing only by a defaulted trailing argument are ambiguous.
      'public.add_ledger_entry(uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text, uuid)',
      'public.void_ledger_entry(uuid, uuid, text)',
      'public.categorize_ledger_entry(uuid, uuid, uuid)',
      'private.ledger_may_read(uuid)',
      'private.ledger_may_write(uuid)',
    ];
    for (const sig of SIGNATURES) {
      const res = await raw<{ anon: boolean; pub: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('public', $1, 'EXECUTE') as pub,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
        [sig],
      );
      expect(res.rows[0].anon, `${sig} must not be executable by anon`).toBe(false);
      expect(res.rows[0].pub, `${sig} must not be executable by PUBLIC`).toBe(false);
      // The app's own role keeps it — the in-function guards are the real
      // control, and revoking it from `authenticated` would break the product.
      if (sig.startsWith('public.')) {
        expect(res.rows[0].auth, `${sig} must stay executable by authenticated`).toBe(true);
      }
    }
  });

  // 0018's revokes ride the same harness bug, and are equally worth pinning: a
  // SECURITY INVOKER trigger function exposed as an RPC is what that file
  // exists to clean up.
  test("0018's trigger functions are not callable as RPCs", async () => {
    for (const sig of [
      'public.enforce_one_group_per_kind_per_trip()',
      'public.enforce_share_link_resource_program()',
      'public.handle_new_auth_user()',
    ]) {
      const res = await raw<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
        [sig],
      );
      expect(res.rows[0].anon, `${sig} must not be callable by anon`).toBe(false);
      expect(res.rows[0].auth, `${sig} must not be callable by authenticated`).toBe(false);
    }
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
//
// AND THE LAST TEST RUNS THE ACTUAL LOADER. The two above it drive
// summarizeSeasonLedger over rows fetched by a hand-written SELECT — which pins
// the reduction, but not loadBoardSnapshot: its paging loop, its filters, its
// category rollup and its "reconciled through" line were never executed here, so
// the defect that shipped (a snapshot printing a PREFIX of the books) could
// return with this suite still green. The third test hands the real loader a
// PostgREST-shaped client over this same connection, so the code path the PDF
// takes is the code path under test.
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

  // THE LOADER ITSELF, over 1,200 real rows, AGAINST THE PAGE'S OWN ARITHMETIC.
  // This is the read the PDF performs — its paging loop, its
  // program+season+not-voided filters, its per-category rollup and its
  // uncategorized bucket — and everything it reports is checked against the
  // figures the on-screen Reports page builds from the SQL aggregates, using the
  // page's own helpers. "The PDF agrees with the page" is the only claim that
  // matters, and it can only be made by running both.
  //
  // The two surfaces used to define a category's actual DIFFERENTLY: both rolled
  // up every cent booked to the category's lines regardless of direction, while
  // the header figures split by the ENTRY's direction — so a refund booked to an
  // expense line added to that category instead of subtracting from it, and two
  // numbers that disagreed could be handed to the same board meeting. One
  // definition now (lib/treasury actualForDirection), on both surfaces.
  test('loadBoardSnapshot reports the whole season, and every category matches the Reports page', async () => {
    const { snapshot, totals, byLine, structure } = await treasurer().tx(async (c) => {
      await c.query(SEED, [A.program, A.seasonActive, A.budgetLine, A.treasurer]);
      const t = await c.query<{
        in_cents: string;
        out_cents: string;
        entry_count: string;
        uncategorized_cents: string;
      }>(`select * from public.ledger_season_totals($1, $2)`, [A.program, A.seasonActive]);
      const l = await c.query<{
        budget_line_id: string | null;
        in_cents: string;
        out_cents: string;
      }>(`select * from public.ledger_line_actuals($1, $2)`, [A.program, A.seasonActive]);
      // What the page reads to learn which category owns which line, and which
      // way that category points.
      const st = await c.query<{
        line_id: string;
        category_id: string;
        category_name: string;
        direction: 'income' | 'expense';
      }>(
        `select bl.id as line_id, bc.id as category_id, bc.name as category_name, bc.direction
           from budget_lines bl
           join budget_categories bc on bc.id = bl.category_id
          where bl.program_id = $1`,
        [A.program],
      );
      const snap = await loadBoardSnapshot(postgrestOver(c), A.seasonActive);
      return { snapshot: snap, totals: t.rows[0], byLine: l.rows, structure: st.rows };
    });

    expect(snapshot).not.toBeNull();
    const s = snapshot!;
    expect(Number(totals.entry_count)).toBeGreaterThan(CAP);

    // The uncategorized bucket the loader carved out equals the aggregate's.
    expect(s.uncategorizedInCents + s.uncategorizedOutCents).toBe(
      Number(totals.uncategorized_cents),
    );

    // ---- The Reports page's rollup, computed the way the page computes it ----
    // lineActualsFromRows over the SQL aggregate, then actualForDirection per
    // category. This is app/(app)/[program]/treasury/reports/page.tsx, verbatim.
    const pageByLine = lineActualsFromRows(byLine);
    const pageByCategory = new Map<string, number>();
    const categoryName = new Map<string, string>();
    for (const row of structure) {
      categoryName.set(row.category_id, row.category_name);
      pageByCategory.set(
        row.category_id,
        (pageByCategory.get(row.category_id) ?? 0) +
          actualForDirection(pageByLine.get(row.line_id), row.direction),
      );
    }

    // Every category the PDF prints carries the figure the page shows for it.
    const pdfCategories = [...s.incomeCategories, ...s.expenseCategories];
    expect(pdfCategories.length).toBeGreaterThan(0);
    for (const cat of pdfCategories) {
      const catId = [...categoryName.entries()].find(([, n]) => n === cat.name)?.[0];
      // A category with no lines has no row in `structure` and is legitimately
      // zero on both surfaces.
      expect(cat.actualCents).toBe(catId ? (pageByCategory.get(catId) ?? 0) : 0);
    }

    // And in the aggregate: the PDF's two totals are the page's category
    // rollups plus the uncategorized bucket it prints as its own line.
    const pageRolledUp = [...pageByCategory.values()].reduce((a, b) => a + b, 0);
    expect(s.totalActualIncome + s.totalActualExpense).toBe(
      pageRolledUp + s.uncategorizedInCents + s.uncategorizedOutCents,
    );

    // The definition itself, pinned: a category counts its OWN direction. The
    // seed books both directions to one expense line, so the old both-directions
    // rollup would have reported strictly more than the money that actually went
    // out — the shape of the number a board would have acted on.
    const bookedBothWays = byLine
      .filter((r) => r.budget_line_id !== null)
      .reduce((sum, r) => sum + Number(r.in_cents) + Number(r.out_cents), 0);
    expect(pageRolledUp).toBeLessThan(bookedBothWays);
    expect(s.totalActualExpense - s.uncategorizedOutCents).toBe(
      byLine
        .filter((r) => r.budget_line_id !== null)
        .reduce((sum, r) => sum + Number(r.out_cents), 0),
    );
  });

  test('loadBoardSnapshot returns null for a season that is not there', async () => {
    const snapshot = await treasurer().tx((c) =>
      loadBoardSnapshot(postgrestOver(c), '00000000-0000-0000-0000-000000000000'),
    );
    expect(snapshot).toBeNull();
  });
});
