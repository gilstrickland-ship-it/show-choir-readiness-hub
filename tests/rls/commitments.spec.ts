// ============================================================================
// commitments.spec.ts — the layer between planned and spent (spec 006, 0021)
// ----------------------------------------------------------------------------
// A commitment is money PROMISED: a purchase order to a vendor (spending), or a
// district allocation / grant / pledge owed to us (expected). It is not a ledger
// row — it never appears on a bank statement — so it gets its own table, and
// that table carries three rules the rest of the money layer does not:
//
//   1. THE ROLE RELAXATION. Every other money write is treasurer-only. Creating
//      a commitment is deliberately widened to director/admin/treasurer, because
//      the anti-fraud value of the whole feature is requester ≠ approver — a
//      treasurer-only model would force the treasurer to raise the requests she
//      then approves, which is the failure mode NCES, NFHS and AVUHSD all
//      prohibit by name. Approve / issue / close stay treasurer-only. The
//      relaxation is TESTED here, not just written down, because that is what
//      makes it a decision rather than a slip.
//
//   2. SELF-APPROVAL IS REFUSED BY THE ENGINE. `approved_by <> requested_by` is
//      a CHECK constraint, so no form, no server action and no service-role code
//      path can be the thing that forgets it.
//
//   3. APPEND-ONLY, LIKE THE LEDGER. "Purchase orders are being altered after
//      the fact" was the top finding of a real district audit, and the auditor's
//      rule is that a modification is a NEW DOCUMENT. The request is frozen at
//      insert; a change is a revision row that supersedes the original; every
//      lifecycle stamp is written once and never rewritten.
//
// Plus the math the feature exists for — Planned → Committed → Spent → Still
// available — computed in SQL so no row cap can reach it (the 0019 lesson), and
// proved equal to the TypeScript reduction the board-snapshot PDF must use.
// ============================================================================

import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { A, B, SUPPORT_USER } from './fixtures';
import { asUser, asAnon, asService, raw, rlsSkipped, RLS_DENIED, type RlsError } from './harness';
import {
  summarizeCommitments,
  summarizeSeasonLedger,
  type CommitmentRow,
  type LedgerEntryRow,
} from '@/lib/treasury';

const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const treasurer = () => asUser(A.treasurer);
const director = () => asUser(A.director);
const admin = () => asUser(A.admin);
const board = () => asUser(A.board);
const costume = () => asUser(A.costume);
const otherTreasurer = () => asUser(B.treasurer);

// Run one statement inside an open transaction and report the SQLSTATE it
// raised (or '' when it succeeded), leaving the transaction usable either way.
// A savepoint, not `rollback; begin` — `set local role` and the auth GUC belong
// to the transaction, and losing them would silently continue as a superuser
// with no auth.uid().
async function probe(c: PoolClient, sql: string, params: unknown[] = []): Promise<string> {
  await c.query('savepoint probe');
  try {
    await c.query(sql, params);
    await c.query('release savepoint probe');
    return '';
  } catch (err) {
    await c.query('rollback to savepoint probe');
    return (err as RlsError).code ?? 'unknown';
  }
}

// A fresh request in program A, on A's season and budget line. Returns its id.
// `number` is deliberately never supplied: it is the database's to assign.
const REQUEST_SQL = `
  insert into commitments
    (id, program_id, season_id, kind, funding_source, vendor, purpose,
     amount_cents, budget_line_id, requested_by)
  values ($1, $2, $3, coalesce($4, 'spending')::commitment_kind,
          coalesce($5, 'district')::commitment_funding_source,
          'Vendor', 'Purpose', coalesce($6, 100000)::bigint, $7, $8)`;

function requestArgs(opts: {
  id?: string;
  kind?: string | null;
  source?: string | null;
  cents?: number | null;
  requestedBy?: string;
} = {}): [string, ...unknown[]] {
  return [
    opts.id ?? randomUUID(),
    A.program,
    A.seasonActive,
    opts.kind ?? null,
    opts.source ?? null,
    opts.cents ?? null,
    A.budgetLine,
    opts.requestedBy ?? A.director,
  ];
}

// ============================================================================
// Tenancy — the composite (id, program_id) foreign keys from 0017
// ----------------------------------------------------------------------------
// Run as the SERVICE role deliberately: it bypasses RLS, so a rejection here
// proves the write is refused on the path a service-role code path with a
// missing filter would actually take. (That each edge really IS a two-column
// key is swept structurally by fk-integrity.spec, which reads the edge list this
// migration extends — so the engine-level backstop is proved there, and what is
// proved here is that nothing gets through.)
//
// TWO LAYERS, AND THE ORDER MATTERS TO READ THE CODES. A commitment's season
// scope is a BEFORE INSERT trigger (a budget line reaches its season through
// category → budget, which no foreign key can express), and a before-trigger
// runs ahead of constraint checking. So a cross-program budget line is caught by
// the trigger with its own code, and the composite key underneath never has to
// fire. The two edges the trigger does not look at — the audit row and the
// ledger's drawdown link — come back as bare 23503, which is the constraint
// itself speaking.
// ============================================================================

describe.skipIf(rlsSkipped())('commitments cannot reach across a tenant boundary', () => {
  test("a commitment cannot sit on another program's budget line", async () => {
    const err = await asService().expectDenied(REQUEST_SQL, [
      randomUUID(), A.program, A.seasonActive, null, null, null, B.budgetLine, A.director,
    ]);
    expect(err.code).toBe('OC025');
  });

  test("a commitment cannot sit on another program's season", async () => {
    const err = await asService().expectDenied(REQUEST_SQL, [
      randomUUID(), A.program, B.seasonActive, null, null, null, A.budgetLine, A.director,
    ]);
    expect(err.code).toBe('OC025');
  });

  test("a revision cannot point at another program's commitment", async () => {
    const err = await asService().expectDenied(
      `insert into commitments
         (id, program_id, season_id, kind, funding_source, vendor, purpose,
          amount_cents, budget_line_id, requested_by, revision_of_id)
       values ($1, $2, $3, 'spending', 'district', 'V', 'P', 100000, $4, $5, $6)`,
      [randomUUID(), A.program, A.seasonActive, A.budgetLine, A.director, B.commitment],
    );
    expect(err.code).toBe('OC026');
  });

  test("a ledger entry cannot draw down another program's commitment", async () => {
    const err = await asService().expectDenied(
      `insert into ledger_entries (id, program_id, season_id, direction, amount_cents, entry_date, commitment_id)
       values ($1, $2, $3, 'out', 100, current_date, $4)`,
      [randomUUID(), A.program, A.seasonActive, B.commitment],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test("a commitment_audit row cannot describe another program's commitment", async () => {
    const err = await asService().expectDenied(
      `insert into commitment_audit (id, program_id, commitment_id, action) values ($1, $2, $3, 'update')`,
      [randomUUID(), A.program, B.commitment],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test("another program's treasurer cannot touch this program's commitment", async () => {
    // An RLS UPDATE denial is a row the policy's USING clause never offered, not
    // an exception: the statement runs and changes nothing. Asserting a raise
    // here would be asserting the wrong mechanism, so assert the outcome — zero
    // rows touched, and the row itself untouched in ground truth.
    const res = await otherTreasurer().query(
      `update commitments set status = 'cancelled', cancelled_at = now() where id = $1`,
      [A.commitment],
    );
    expect(res.rowCount).toBe(0);
    const truth = await raw<{ status: string }>(`select status from commitments where id = $1`, [A.commitment]);
    expect(truth.rows[0].status).toBe('requested');
  });

  test("another program's treasurer sees none of these commitments", async () => {
    expect(await otherTreasurer().count(`select 1 from commitments where program_id = $1`, [A.program])).toBe(0);
  });
});

// ============================================================================
// §4 of the spec — who may ask, and who may approve
// ============================================================================

describe.skipIf(rlsSkipped())('the deliberate role relaxation: director asks, treasurer approves', () => {
  test('a DIRECTOR may raise a request — the widening this feature turns on', async () => {
    // Today's rule is treasurer-only for every money write. This is the one
    // deliberate exception, and it exists so that requester ≠ approver is
    // possible at all.
    expect(await director().allows(REQUEST_SQL, requestArgs())).toBe(true);
  });

  test('an ADMIN may raise a request', async () => {
    expect(await admin().allows(REQUEST_SQL, requestArgs())).toBe(true);
  });

  test('the TREASURER may raise one too (she just may not approve her own)', async () => {
    expect(await treasurer().allows(REQUEST_SQL, requestArgs())).toBe(true);
  });

  test('a BOARD MEMBER may not — the transparency seat writes nothing', async () => {
    const err = await board().expectDenied(REQUEST_SQL, requestArgs());
    expect(err.code).toBe(RLS_DENIED);
  });

  test('a COSTUME MANAGER may not, and cannot read them either — money is not that seat', async () => {
    const err = await costume().expectDenied(REQUEST_SQL, requestArgs());
    expect(err.code).toBe(RLS_DENIED);
    expect(await costume().count(`select 1 from commitments`)).toBe(0);
  });

  // The update policy is treasurer-only, and an RLS UPDATE denial FILTERS rather
  // than raises — the row is simply not among the ones the statement can see. So
  // the assertion is "nothing was touched", checked against ground truth read
  // with RLS bypassed, which is the only way to see that the row really did not
  // move.
  test.each([
    ['a director', () => director(), A.director],
    ['an admin', () => admin(), A.admin],
    ['a board member', () => board(), A.board],
  ])('%s may NOT approve — approval is the treasurer’s, and only hers', async (_who, who, actor) => {
    const res = await who().query(
      `update commitments set status = 'approved', approved_by = $2, approved_at = now() where id = $1`,
      [A.commitment, actor],
    );
    expect(res.rowCount).toBe(0);
    const truth = await raw<{ approved_at: string | null }>(
      `select approved_at from commitments where id = $1`,
      [A.commitment],
    );
    expect(truth.rows[0].approved_at).toBeNull();
  });

  test('the treasurer approves a request someone else raised', async () => {
    const ok = await treasurer().allows(
      `update commitments set status = 'approved', approved_by = $2, approved_at = now() where id = $1`,
      [A.commitment, A.treasurer],
    );
    expect(ok).toBe(true);
  });

  test('board and director READ everything — full money transparency is the control', async () => {
    expect(await board().count(`select 1 from commitments where id = $1`, [A.commitment])).toBe(1);
    expect(await director().count(`select 1 from commitments where id = $1`, [A.commitment])).toBe(1);
    expect(await board().count(`select 1 from commitment_audit where commitment_id = $1`, [A.commitment]))
      .toBeGreaterThan(0);
  });

  test('support WITH consent reads them; WITHOUT consent it does not', async () => {
    expect(await asUser(SUPPORT_USER).count(`select 1 from commitments where id = $1`, [A.commitment])).toBe(1);
    expect(await asUser(SUPPORT_USER).count(`select 1 from commitments where id = $1`, [B.commitment])).toBe(0);
  });

  test('support never writes one', async () => {
    const err = await asUser(SUPPORT_USER).expectDenied(REQUEST_SQL, requestArgs());
    expect(err.code).toBe(RLS_DENIED);
  });
});

// ============================================================================
// Self-approval — the rule the whole feature earns its keep on
// ============================================================================

describe.skipIf(rlsSkipped())('requester ≠ approver, enforced by the database', () => {
  test('a treasurer cannot approve a request she raised herself', async () => {
    const code = await treasurer().tx(async (c) => {
      const id = randomUUID();
      // She may RAISE it — that is the relaxation working.
      await c.query(REQUEST_SQL, requestArgs({ id, requestedBy: A.treasurer }));
      const mine = await c.query<{ requested_by: string }>(
        `select requested_by from commitments where id = $1`,
        [id],
      );
      // Stamped from auth.uid(), not taken from the statement.
      expect(mine.rows[0].requested_by).toBe(A.treasurer);
      return probe(
        c,
        `update commitments set status = 'approved', approved_by = $2, approved_at = now() where id = $1`,
        [id, A.treasurer],
      );
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  test('nor by naming somebody else as the approver', async () => {
    // The same fraud with a second name on it: a treasurer recording the
    // DIRECTOR as having approved the director's own request.
    const code = await treasurer().tx((c) =>
      probe(
        c,
        `update commitments set status = 'approved', approved_by = $2, approved_at = now() where id = $1`,
        [A.commitment, A.admin],
      ),
    );
    expect(code).toBe('OC024');
  });

  test('an approval is a person and a moment together, or neither', async () => {
    const code = await treasurer().tx((c) =>
      probe(c, `update commitments set approved_at = now() where id = $1`, [A.commitment]),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  test('a commitment cannot be BORN approved (a requester forging their own sign-off)', async () => {
    const code = await director().tx((c) =>
      probe(
        c,
        `insert into commitments
           (program_id, season_id, kind, funding_source, vendor, purpose, amount_cents,
            budget_line_id, requested_by, status, approved_by, approved_at)
         values ($1, $2, 'spending', 'district', 'V', 'P', 100000, $3, $4, 'approved', $5, now())`,
        [A.program, A.seasonActive, A.budgetLine, A.director, A.treasurer],
      ),
    );
    expect(code).toBe('OC022');
  });

  test('nor born closed, issued or received', async () => {
    for (const [col, value] of [
      ['issued_at', 'now()'],
      ['received_at', 'now()'],
    ] as const) {
      const code = await director().tx((c) =>
        probe(
          c,
          `insert into commitments
             (program_id, season_id, kind, funding_source, vendor, purpose, amount_cents,
              budget_line_id, requested_by, ${col})
           values ($1, $2, 'spending', 'district', 'V', 'P', 100000, $3, $4, ${value})`,
          [A.program, A.seasonActive, A.budgetLine, A.director],
        ),
      );
      expect(code, col).toBe('OC022');
    }
  });
});

// ============================================================================
// Append-only — the request is frozen; only the lifecycle moves
// ============================================================================

describe.skipIf(rlsSkipped())('a commitment is append-only (R2)', () => {
  const frozen: [string, string][] = [
    ['amount_cents', 'amount_cents = 999999'],
    ['shipping_cents', 'shipping_cents = 4242'],
    ['tax_cents', 'tax_cents = 4242'],
    ['vendor', `vendor = 'Somebody Else'`],
    ['purpose', `purpose = 'Something Else'`],
    ['need_by', `need_by = current_date + 400`],
    ['funding_source', `funding_source = 'booster'`],
    ['kind', `kind = 'expected'`],
    ['budget_line_id', `budget_line_id = budget_line_id`],
    ['number', 'number = number + 100'],
    ['after_the_fact', 'after_the_fact = true'],
    ['requested_by', `requested_by = requested_by`],
  ];

  test.each(frozen)('changing %s is refused — a change is a revision, not an edit', async (col, setter) => {
    // budget_line_id / requested_by set themselves to their own value, which is
    // NOT distinct and so must be permitted; the columns are covered by the
    // cross-program cases elsewhere. Every other one must raise OC020.
    const selfAssign = col === 'budget_line_id' || col === 'requested_by';
    const code = await treasurer().tx((c) =>
      probe(c, `update commitments set ${setter} where id = $1`, [A.commitment]),
    );
    expect(code).toBe(selfAssign ? '' : 'OC020');
  });

  test('the money itself is untouched by the refusal', async () => {
    const truth = await raw<{ amount_cents: string }>(
      `select amount_cents from commitments where id = $1`,
      [A.commitment],
    );
    expect(Number(truth.rows[0].amount_cents)).toBe(300000);
  });

  test('an approval cannot be un-done or re-written', async () => {
    // A.commitmentApproved is seeded approved by the treasurer against the
    // director's request. Un-approving would silently re-open a document.
    const cleared = await treasurer().tx((c) =>
      probe(c, `update commitments set approved_at = null, approved_by = null, status = 'requested' where id = $1`,
        [A.commitmentApproved]),
    );
    expect(cleared).toBe('OC021');

    const rewritten = await treasurer().tx((c) =>
      probe(c, `update commitments set approved_at = now() where id = $1`, [A.commitmentApproved]),
    );
    expect(rewritten).toBe('OC021');
  });

  test('a closing, and its released amount, are recorded once', async () => {
    const code = await treasurer().tx(async (c) => {
      await c.query(
        `update commitments set status = 'closed', closed_at = now(), close_reason = 'done', released_cents = 15000
          where id = $1`,
        [A.commitment],
      );
      return probe(c, `update commitments set released_cents = 999999 where id = $1`, [A.commitment]);
    });
    expect(code).toBe('OC021');
  });

  test('the lifecycle itself still moves — issuing an approved commitment is allowed', async () => {
    const ok = await treasurer().allows(
      `update commitments set status = 'issued', issued_at = now(), external_ref = 'DISTRICT-PO-4471'
        where id = $1`,
      [A.commitmentApproved],
    );
    expect(ok).toBe(true);
  });

  test('nothing deletes a commitment (no delete policy)', async () => {
    const res = await treasurer().query(`delete from commitments where id = $1`, [A.commitment]);
    expect(res.rowCount).toBe(0);
  });

  test('an archived season’s commitments are frozen', async () => {
    // Readable — an archived season's books stay open to read.
    expect(await treasurer().count(`select 1 from commitments where id = $1`, [A.commitmentArchived])).toBe(1);
    // But not writable: the policy's USING clause excludes it, so the update
    // touches nothing.
    const res = await treasurer().query(
      `update commitments set status = 'cancelled', cancelled_at = now() where id = $1`,
      [A.commitmentArchived],
    );
    expect(res.rowCount).toBe(0);
    // And no new one may be raised against it. An INSERT denial DOES raise —
    // there is no row to filter out, so the WITH CHECK is what refuses it.
    const insert = await director().expectDenied(REQUEST_SQL, [
      randomUUID(), A.program, A.seasonArchived, null, null, null, A.budgetLineArchived, A.director,
    ]);
    expect(insert.code).toBe(RLS_DENIED);
  });
});

// ============================================================================
// The audit trail
// ============================================================================

describe.skipIf(rlsSkipped())('commitment_audit is written by the database and by nobody else', () => {
  test('creating a commitment writes its create row in the same transaction', async () => {
    const rows = await director().tx(async (c) => {
      const id = randomUUID();
      await c.query(REQUEST_SQL, requestArgs({ id }));
      const audit = await c.query<{ action: string; diff: Record<string, unknown> }>(
        `select action, diff from commitment_audit where commitment_id = $1`,
        [id],
      );
      return audit.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create');
    expect(Number(rows[0].diff.amount_cents)).toBe(100000);
  });

  test('approving writes an approve row naming the approver', async () => {
    const rows = await treasurer().tx(async (c) => {
      await c.query(
        `update commitments set status = 'approved', approved_by = $2, approved_at = now() where id = $1`,
        [A.commitment, A.treasurer],
      );
      const audit = await c.query<{ action: string; actor: string }>(
        `select action, actor from commitment_audit where commitment_id = $1 and action = 'approve'`,
        [A.commitment],
      );
      return audit.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(A.treasurer);
  });

  test('not even the treasurer may write an audit row by hand (no insert policy)', async () => {
    const err = await treasurer().expectDenied(
      `insert into commitment_audit (program_id, commitment_id, action) values ($1, $2, 'close')`,
      [A.program, A.commitment],
    );
    expect(err.code).toBe(RLS_DENIED);
  });

  test('updating or deleting an audit row touches nothing', async () => {
    const id = (await raw<{ id: string }>(
      `select id from commitment_audit where commitment_id = $1 limit 1`,
      [A.commitment],
    )).rows[0].id;
    expect((await treasurer().query(`update commitment_audit set action = 'close' where id = $1`, [id])).rowCount).toBe(0);
    expect((await treasurer().query(`delete from commitment_audit where id = $1`, [id])).rowCount).toBe(0);
  });
});

// ============================================================================
// Numbering — server-assigned, per program PER FUNDING SOURCE
// ----------------------------------------------------------------------------
// The two purses never share identity: a booster must not issue, or appear to
// issue, the district's purchase order. That is a legal constraint (Ohio
// guidance, AVUHSD policy, the Texas Comptroller), which is why numbering is a
// database concern and not a form field.
// ============================================================================

describe.skipIf(rlsSkipped())('numbering', () => {
  test('numbers run independently per funding source, and never come from the writer', async () => {
    const out = await director().tx(async (c) => {
      const maxOf = async (source: string) => {
        const r = await c.query<{ n: number | null }>(
          `select max(number) as n from commitments where program_id = $1 and funding_source = $2::commitment_funding_source`,
          [A.program, source],
        );
        return Number(r.rows[0].n ?? 0);
      };
      const d0 = await maxOf('district');
      const b0 = await maxOf('booster');

      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await c.query(REQUEST_SQL, requestArgs({ id: ids[0], source: 'district' }));
      await c.query(REQUEST_SQL, requestArgs({ id: ids[1], source: 'district' }));
      await c.query(REQUEST_SQL, requestArgs({ id: ids[2], source: 'booster' }));

      const rows = await c.query<{ id: string; number: number; revision: number }>(
        `select id, number, revision from commitments where id = any($1::uuid[])`,
        [ids],
      );
      return { d0, b0, byId: new Map(rows.rows.map((r) => [r.id, r])), ids };
    });

    expect(out.byId.get(out.ids[0])!.number).toBe(out.d0 + 1);
    expect(out.byId.get(out.ids[1])!.number).toBe(out.d0 + 2);
    // The booster's sequence is its own — it does not continue the district's.
    expect(out.byId.get(out.ids[2])!.number).toBe(out.b0 + 1);
    for (const id of out.ids) expect(out.byId.get(id)!.revision).toBe(0);
  });

  test('a number posted by the writer is overwritten, never honoured', async () => {
    const assigned = await director().tx(async (c) => {
      const id = randomUUID();
      await c.query(
        `insert into commitments
           (id, program_id, season_id, kind, funding_source, number, vendor, purpose,
            amount_cents, budget_line_id, requested_by)
         values ($1, $2, $3, 'spending', 'district', 999999, 'V', 'P', 100000, $4, $5)`,
        [id, A.program, A.seasonActive, A.budgetLine, A.director],
      );
      const r = await c.query<{ number: number }>(`select number from commitments where id = $1`, [id]);
      return r.rows[0].number;
    });
    expect(assigned).not.toBe(999999);
  });

  test('two programs number independently — B’s #1 and A’s #1 coexist', async () => {
    const rows = await raw<{ program_id: string; number: number }>(
      `select program_id, number from commitments where id = any($1::uuid[])`,
      [[A.commitment, B.commitment]],
    );
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((r) => r.number)).size).toBe(1);
  });

  test('a budget line from another season is refused (no line, no encumbrance, no math)', async () => {
    const code = await director().tx((c) =>
      probe(c, REQUEST_SQL, [
        randomUUID(), A.program, A.seasonActive, null, null, null, A.budgetLineArchived, A.director,
      ]),
    );
    expect(code).toBe('OC025');
  });
});

// ============================================================================
// Revisions — "a modification is a new document" (R2)
// ============================================================================

const REVISE_SQL = `
  insert into commitments
    (id, program_id, season_id, kind, funding_source, vendor, purpose,
     amount_cents, budget_line_id, requested_by, revision_of_id)
  values ($1, $2, $3, $4::commitment_kind, $5::commitment_funding_source,
          'Vendor', 'Purpose', $6::bigint, $7, $8, $9)`;

describe.skipIf(rlsSkipped())('revisions supersede rather than edit', () => {
  test('a revision keeps the number, takes the next revision, and supersedes the original', async () => {
    const out = await treasurer().tx(async (c) => {
      const revId = randomUUID();
      await c.query(REVISE_SQL, [
        revId, A.program, A.seasonActive, 'spending', 'district', 480000,
        A.budgetLine, A.director, A.commitment,
      ]);
      const chain = await c.query<{
        id: string; number: number; revision: number; status: string;
        superseded_at: string | null; amount_cents: string; revision_of_id: string | null;
      }>(
        `select id, number, revision, status, superseded_at, amount_cents, revision_of_id
           from commitments where id = any($1::uuid[]) order by revision`,
        [[A.commitment, revId]],
      );
      const audit = await c.query<{ action: string }>(
        `select action from commitment_audit where commitment_id = $1 and action = 'supersede'`,
        [A.commitment],
      );
      return { chain: chain.rows, superseded: audit.rows.length };
    });

    const [original, revision] = out.chain;
    // THE CHAIN IS READABLE: both rows are there, both visible, and the link
    // between them is a column, not a guess.
    expect(out.chain).toHaveLength(2);
    expect(revision.number).toBe(original.number);
    expect(revision.revision).toBe(original.revision + 1);
    expect(revision.revision_of_id).toBe(original.id);
    expect(Number(revision.amount_cents)).toBe(480000);
    // The original keeps its own amount forever — it is superseded, not edited.
    expect(Number(original.amount_cents)).toBe(300000);
    expect(original.status).toBe('superseded');
    expect(original.superseded_at).not.toBeNull();
    expect(out.superseded).toBe(1);
  });

  test('the revision chain does not fork — one successor per document', async () => {
    const code = await treasurer().tx(async (c) => {
      await c.query(REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'district', 480000,
        A.budgetLine, A.director, A.commitment,
      ]);
      return probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'district', 490000,
        A.budgetLine, A.director, A.commitment,
      ]);
    });
    // Either the "already superseded" guard or the unique index catches it; both
    // are the same refusal, and neither leaves two live successors behind.
    expect(['OC026', UNIQUE_VIOLATION]).toContain(code);
  });

  test('a revision may not change the purse or the subtype it came from', async () => {
    const source = await treasurer().tx((c) =>
      probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'booster', 480000,
        A.budgetLine, A.director, A.commitment,
      ]),
    );
    expect(source).toBe('OC027');

    const kind = await treasurer().tx((c) =>
      probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'expected', 'district', 480000,
        A.budgetLine, A.director, A.commitment,
      ]),
    );
    expect(kind).toBe('OC027');
  });

  test('a closed commitment has nothing left to revise', async () => {
    const code = await treasurer().tx(async (c) => {
      await c.query(
        `update commitments set status = 'closed', closed_at = now(), close_reason = 'done', released_cents = 0
          where id = $1`,
        [A.commitment],
      );
      return probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'district', 480000,
        A.budgetLine, A.director, A.commitment,
      ]);
    });
    expect(code).toBe('OC026');
  });

  test('a DIRECTOR cannot restate an APPROVED commitment — that is the treasurer’s', async () => {
    // The escalation this guard closes: the insert policy admits directors, so
    // without it a director could revise their own approved $1,200 request to
    // $12,000 and the approval would ride along on a row nobody re-approved.
    const code = await director().tx((c) =>
      probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'booster', 500000,
        A.budgetLine, A.director, A.commitmentApproved,
      ]),
    );
    expect(code).toBe(RLS_DENIED);
  });

  test('the treasurer may', async () => {
    const ok = await treasurer().tx((c) =>
      probe(c, REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'booster', 500000,
        A.budgetLine, A.director, A.commitmentApproved,
      ]),
    );
    expect(ok).toBe('');
  });
});

// ============================================================================
// The math — Planned → Committed → Spent → Still available
// ============================================================================

describe.skipIf(rlsSkipped())('commitment_totals / commitment_line_totals — gates', () => {
  const totals = `select * from public.commitment_totals($1, $2)`;
  const lines = `select * from public.commitment_line_totals($1, $2)`;

  test('the treasury readers read them; costume_manager does not', async () => {
    expect(await treasurer().count(totals, [A.program, A.seasonActive])).toBe(1);
    expect(await director().count(totals, [A.program, A.seasonActive])).toBe(1);
    expect(await board().count(totals, [A.program, A.seasonActive])).toBe(1);
    const err = await costume().expectDenied(totals, [A.program, A.seasonActive]);
    expect(err.code).toBe(RLS_DENIED);
  });

  test("another program's treasurer, and anon, are refused", async () => {
    expect((await otherTreasurer().expectDenied(totals, [A.program, A.seasonActive])).code).toBe(RLS_DENIED);
    expect((await otherTreasurer().expectDenied(lines, [A.program, A.seasonActive])).code).toBe(RLS_DENIED);
    expect((await asAnon().expectDenied(totals, [A.program, A.seasonActive])).code).toBe(RLS_DENIED);
  });

  test('support with consent reads them, without consent does not', async () => {
    expect(await asUser(SUPPORT_USER).count(totals, [A.program, A.seasonActive])).toBe(1);
    expect((await asUser(SUPPORT_USER).expectDenied(totals, [B.program, B.seasonActive])).code).toBe(RLS_DENIED);
  });

  test('the private row-returning helper is not reachable by any API role', async () => {
    // Unlike ledger_may_read, this one RETURNS ROWS: left with 0007's default
    // grants, any signed-in user could read any program's committed amounts by
    // naming its id. The public wrapper reaches it as the owner, after its gate.
    for (const role of ['anon', 'authenticated', 'public']) {
      const res = await raw<{ ok: boolean }>(
        `select has_function_privilege($1, 'private.commitment_drawdown(uuid, uuid)', 'EXECUTE') as ok`,
        [role],
      );
      expect(res.rows[0].ok, `private.commitment_drawdown must not be executable by ${role}`).toBe(false);
    }
  });

  test('the public aggregates keep exactly the exposure the ledger ones have', async () => {
    for (const sig of [
      'public.commitment_totals(uuid, uuid)',
      'public.commitment_line_totals(uuid, uuid)',
    ]) {
      const res = await raw<{ anon: boolean; pub: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('public', $1, 'EXECUTE') as pub,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
        [sig],
      );
      expect(res.rows[0].anon, `${sig} / anon`).toBe(false);
      expect(res.rows[0].pub, `${sig} / PUBLIC`).toBe(false);
      expect(res.rows[0].auth, `${sig} / authenticated`).toBe(true);
    }
  });

  test('the commitment trigger functions are not callable as RPCs (0018’s rule)', async () => {
    for (const sig of [
      'public.assign_commitment_number()',
      'public.enforce_commitment_append_only()',
      'public.log_commitment_change()',
    ]) {
      const res = await raw<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
        [sig],
      );
      expect(res.rows[0].anon, `${sig} / anon`).toBe(false);
      expect(res.rows[0].auth, `${sig} / authenticated`).toBe(false);
    }
  });
});

describe.skipIf(rlsSkipped())('commitment_totals — what it counts', () => {
  const totals = `select * from public.commitment_totals($1, $2)`;

  interface TotalsRow {
    open_committed_cents: string;
    open_expected_cents: string;
    committed_gross_cents: string;
    drawn_cents: string;
    open_count: string;
    expected_count: string;
    stale_count: string;
    overspent_count: string;
    after_the_fact_count: string;
  }

  test('the seeded season: two open purchase orders, one expected, nothing drawn', async () => {
    const r = await treasurer().query<TotalsRow>(totals, [A.program, A.seasonActive]);
    const t = r.rows[0];
    // 300000 + 15000 shipping + 5000 tax, plus the approved 120000.
    expect(Number(t.open_committed_cents)).toBe(440000);
    expect(Number(t.committed_gross_cents)).toBe(440000);
    expect(Number(t.drawn_cents)).toBe(0);
    // Expected money is its OWN number and is never folded into committed —
    // you may not spend money you have merely been promised.
    expect(Number(t.open_expected_cents)).toBe(50000);
    expect(Number(t.open_count)).toBe(2);
    expect(Number(t.expected_count)).toBe(1);
    expect(Number(t.stale_count)).toBe(0);
    expect(Number(t.overspent_count)).toBe(0);
    expect(Number(t.after_the_fact_count)).toBe(0);
  });

  test('a payment against a purchase order draws it down and leaves it OPEN (R3)', async () => {
    const out = await treasurer().tx(async (c) => {
      const read = async () => (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
      const before = await read();
      await c.query(
        `select public.add_ledger_entry($1, $2, current_date, 'out', 305000, $3, null, null, 'paid', 'Costume Co', null, $4)`,
        [A.program, A.seasonActive, A.budgetLine, A.commitment],
      );
      const after = await read();
      const status = await c.query<{ status: string }>(`select status from commitments where id = $1`, [A.commitment]);
      return { before, after, status: status.rows[0].status };
    });

    // committed $3,200 · paid $3,050 · $150 still committed
    expect(Number(out.before.open_committed_cents)).toBe(440000);
    expect(Number(out.after.open_committed_cents)).toBe(440000 - 305000);
    expect(Number(out.after.drawn_cents)).toBe(305000);
    // Gross does not move — the PROMISE is unchanged; only what is left of it.
    expect(Number(out.after.committed_gross_cents)).toBe(440000);
    // And the commitment stays open: paying is not closing (R4).
    expect(out.status).toBe('requested');
    expect(Number(out.after.open_count)).toBe(2);
  });

  test('money IN never draws down a purchase order (a misdirected entry stays out of it)', async () => {
    const after = await treasurer().tx(async (c) => {
      await c.query(
        `select public.add_ledger_entry($1, $2, current_date, 'in', 305000, $3, null, null, null, null, null, $4)`,
        [A.program, A.seasonActive, A.budgetLine, A.commitment],
      );
      return (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
    });
    expect(Number(after.open_committed_cents)).toBe(440000);
    expect(Number(after.drawn_cents)).toBe(0);
  });

  test('overspend WARNS, never blocks (R5): remaining floors at zero and the count rises', async () => {
    const after = await treasurer().tx(async (c) => {
      await c.query(
        `select public.add_ledger_entry($1, $2, current_date, 'out', 500000, $3, null, null, null, null, null, $4)`,
        [A.program, A.seasonActive, A.budgetLine, A.commitment],
      );
      return (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
    });
    // 320000 committed, 500000 paid: the overrun never reads as NEGATIVE money
    // still committed, and the only other open commitment's 120000 is all that
    // is left.
    expect(Number(after.open_committed_cents)).toBe(120000);
    expect(Number(after.overspent_count)).toBe(1);
  });

  test('closing takes it out of committed; cancelling and superseding do too', async () => {
    for (const [what, sql] of [
      ['closed', `update commitments set status = 'closed', closed_at = now(), close_reason = 'received short', released_cents = 20000 where id = $1`],
      ['cancelled', `update commitments set status = 'cancelled', cancelled_at = now(), cancel_reason = 'not needed' where id = $1`],
    ] as const) {
      const after = await treasurer().tx(async (c) => {
        await c.query(sql, [A.commitment]);
        return (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
      });
      expect(Number(after.open_committed_cents), what).toBe(120000);
      expect(Number(after.open_count), what).toBe(1);
    }
  });

  test('a revision replaces its original rather than adding to it', async () => {
    const after = await treasurer().tx(async (c) => {
      await c.query(REVISE_SQL, [
        randomUUID(), A.program, A.seasonActive, 'spending', 'district', 480000,
        A.budgetLine, A.director, A.commitment,
      ]);
      return (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
    });
    // 480000 (the revision) + 120000 (the untouched approved one). The
    // superseded 320000 is gone, not double-counted.
    expect(Number(after.open_committed_cents)).toBe(600000);
    expect(Number(after.open_count)).toBe(2);
  });

  test('a need-by already past counts as stale, on the PROGRAM’s calendar', async () => {
    // The need-by has to be set AT INSERT: it is one of the frozen columns, so
    // there is no "update it to yesterday" path — which is itself the R2 rule
    // working (a purchase order's promised date is not editable after the fact).
    const after = await treasurer().tx(async (c) => {
      await c.query(
        `insert into commitments
           (program_id, season_id, kind, funding_source, vendor, purpose, amount_cents,
            budget_line_id, need_by, requested_by)
         values ($1, $2, 'spending', 'district', 'Late Vendor', 'Overdue', 100000, $3, current_date - 5, $4)`,
        [A.program, A.seasonActive, A.budgetLine, A.director],
      );
      return (await c.query<TotalsRow>(totals, [A.program, A.seasonActive])).rows[0];
    });
    expect(Number(after.stale_count)).toBe(1);
  });

  test('per line: the same money, grouped by the budget line it is promised against', async () => {
    const rows = await treasurer().query<{
      budget_line_id: string;
      open_committed_cents: string;
      open_expected_cents: string;
    }>(`select * from public.commitment_line_totals($1, $2)`, [A.program, A.seasonActive]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].budget_line_id).toBe(A.budgetLine);
    expect(Number(rows.rows[0].open_committed_cents)).toBe(440000);
    expect(Number(rows.rows[0].open_expected_cents)).toBe(50000);
  });
});

// ============================================================================
// The drawdown link on the ledger (T173 / R3)
// ============================================================================

describe.skipIf(rlsSkipped())('linking a ledger entry to a commitment', () => {
  test("a commitment from another SEASON is refused, like every other tag", async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null, $3)`,
      [A.program, A.seasonActive, A.commitmentArchived],
    );
    expect(err.code).toBe('OC016');
  });

  test("another program's commitment is refused outright", async () => {
    const err = await treasurer().expectDenied(
      `select public.add_ledger_entry($1, $2, current_date, 'out', 100, null, null, null, null, null, null, $3)`,
      [A.program, A.seasonActive, B.commitment],
    );
    expect(err.code).toBe('OC016');
  });

  test('the link is frozen on the entry, like every other financial column', async () => {
    // Moving a payment from one purchase order to another after the fact is
    // precisely the alteration this feature exists to make impossible — and
    // before 0021 the void-only trigger did not name this column.
    const err = await treasurer().expectDenied(
      `update ledger_entries set commitment_id = $2 where id = $1`,
      [A.ledgerLive, A.commitment],
    );
    expect(err.message).toMatch(/immutable/i);
  });

  test('filing an entry onto a budget line carries its commitment link forward', async () => {
    // A replacement that dropped the link would silently release money back into
    // the available balance — the same class of defect as dropping the receipt.
    const out = await treasurer().tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `select public.add_ledger_entry($1, $2, current_date, 'out', 4200, null, null, null, 'x', 'y', null, $3) as id`,
        [A.program, A.seasonActive, A.commitment],
      );
      const newId = await c.query<{ id: string }>(
        `select public.categorize_ledger_entry($1, $2, $3) as id`,
        [ins.rows[0].id, A.program, A.budgetLine],
      );
      const row = await c.query<{ commitment_id: string | null }>(
        `select commitment_id from ledger_entries where id = $1`,
        [newId.rows[0].id],
      );
      return row.rows[0].commitment_id;
    });
    expect(out).toBe(A.commitment);
  });

  test('a voided payment stops drawing the commitment down', async () => {
    const out = await treasurer().tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `select public.add_ledger_entry($1, $2, current_date, 'out', 100000, null, null, null, null, null, null, $3) as id`,
        [A.program, A.seasonActive, A.commitment],
      );
      const drawn = async () =>
        Number(
          (await c.query<{ drawn_cents: string }>(
            `select drawn_cents from public.commitment_totals($1, $2)`,
            [A.program, A.seasonActive],
          )).rows[0].drawn_cents,
        );
      const before = await drawn();
      await c.query(`select public.void_ledger_entry($1, $2, 'wrong PO')`, [ins.rows[0].id, A.program]);
      return { before, after: await drawn() };
    });
    expect(out.before).toBe(100000);
    expect(out.after).toBe(0);
  });
});

// ============================================================================
// The PDF agrees with the page
// ----------------------------------------------------------------------------
// The board-snapshot PDF runs on a SERVICE-ROLE client where auth.uid() is null,
// so private.ledger_may_read refuses and it cannot call the aggregates above. It
// pages the raw rows and reduces them in TypeScript instead — which is only safe
// if the reduction IS the SQL's definition. Both run here, over the same rows,
// in real Postgres, past PostgREST's 1000-row cap.
// ============================================================================

describe.skipIf(rlsSkipped())('summarizeCommitments equals the SQL aggregates', () => {
  const CAP = 1000;

  // 1,100 commitments: a mix of subtypes, some already drawn down, one in seven
  // closed, one in eleven flagged as recorded after the purchase.
  const SEED_COMMITMENTS = `
    insert into commitments
      (program_id, season_id, kind, funding_source, vendor, purpose,
       amount_cents, shipping_cents, tax_cents, budget_line_id, need_by, requested_by)
    select $1, $2,
           (case when g % 4 = 0 then 'expected' else 'spending' end)::commitment_kind,
           (case when g % 3 = 0 then 'booster' else 'district' end)::commitment_funding_source,
           'Vendor ' || g, 'Purpose ' || g,
           10000 + g, (g % 7) * 100, (g % 5) * 10,
           $3, current_date + ((g % 90) - 30), $4
      from generate_series(1, 1100) g`;

  const READ_COMMITMENTS = `
    select id, kind, budget_line_id,
           amount_cents::text   as amount_cents,
           shipping_cents::text as shipping_cents,
           tax_cents::text      as tax_cents,
           to_char(need_by, 'YYYY-MM-DD') as need_by,
           after_the_fact, closed_at, cancelled_at, superseded_at
      from commitments
     where program_id = $1 and season_id = $2
     order by id`;

  const READ_LEDGER = `
    select direction,
           amount_cents::text as amount_cents,
           budget_line_id,
           commitment_id,
           to_char(entry_date, 'YYYY-MM-DD') as entry_date,
           voided_at
      from ledger_entries
     where program_id = $1 and season_id = $2 and voided_at is null
     order by id`;

  test('every total matches, past the row cap that used to truncate them', async () => {
    const out = await treasurer().tx(async (c) => {
      await c.query(SEED_COMMITMENTS, [A.program, A.seasonActive, A.budgetLine, A.director]);
      // Close one in seven, flag one in eleven, and pay something against a
      // handful — so every branch of the reduction has rows to exercise.
      await c.query(
        `update commitments set status = 'closed', closed_at = now(), close_reason = 'done', released_cents = 0
          where program_id = $1 and season_id = $2 and number % 7 = 0 and closed_at is null`,
        [A.program, A.seasonActive],
      );
      await c.query(
        `insert into ledger_entries (program_id, season_id, entry_date, direction, amount_cents, budget_line_id, commitment_id, entered_by)
         select $1, $2, current_date, 'out', 5000, $3, id, $4
           from commitments
          where program_id = $1 and season_id = $2 and kind = 'spending' and number % 13 = 0`,
        [A.program, A.seasonActive, A.budgetLine, A.treasurer],
      );

      const sqlTotals = await c.query(`select * from public.commitment_totals($1, $2)`, [A.program, A.seasonActive]);
      const sqlLines = await c.query<{
        budget_line_id: string;
        open_committed_cents: string;
        open_expected_cents: string;
      }>(`select * from public.commitment_line_totals($1, $2)`, [A.program, A.seasonActive]);
      const commitments = await c.query<CommitmentRow>(READ_COMMITMENTS, [A.program, A.seasonActive]);
      const ledger = await c.query<LedgerEntryRow>(READ_LEDGER, [A.program, A.seasonActive]);
      const today = await c.query<{ d: string }>(
        `select to_char((now() at time zone pr.timezone)::date, 'YYYY-MM-DD') as d
           from programs pr where pr.id = $1`,
        [A.program],
      );
      return {
        sqlTotals: sqlTotals.rows[0] as Record<string, string>,
        sqlLines: sqlLines.rows,
        commitments: commitments.rows,
        ledger: ledger.rows,
        today: today.rows[0].d,
      };
    });

    // Past the cap on purpose: below it there is no defect to catch.
    expect(out.commitments.length).toBeGreaterThan(CAP);

    const { byCommitment } = summarizeSeasonLedger(out.ledger);
    const js = summarizeCommitments(out.commitments, byCommitment, out.today);

    expect(js.totals.openCommittedCents).toBe(Number(out.sqlTotals.open_committed_cents));
    expect(js.totals.openExpectedCents).toBe(Number(out.sqlTotals.open_expected_cents));
    expect(js.totals.committedGrossCents).toBe(Number(out.sqlTotals.committed_gross_cents));
    expect(js.totals.drawnCents).toBe(Number(out.sqlTotals.drawn_cents));
    expect(js.totals.openCount).toBe(Number(out.sqlTotals.open_count));
    expect(js.totals.expectedCount).toBe(Number(out.sqlTotals.expected_count));
    expect(js.totals.staleCount).toBe(Number(out.sqlTotals.stale_count));
    expect(js.totals.overspentCount).toBe(Number(out.sqlTotals.overspent_count));
    expect(js.totals.afterTheFactCount).toBe(Number(out.sqlTotals.after_the_fact_count));

    // The figures are big enough that an accidentally-empty reduction would not
    // have passed the comparisons above.
    expect(js.totals.openCommittedCents).toBeGreaterThan(0);
    expect(js.totals.drawnCents).toBeGreaterThan(0);
    expect(js.totals.staleCount).toBeGreaterThan(0);

    // Per line, both directions of the map.
    expect(js.byLine.size).toBe(out.sqlLines.length);
    for (const row of out.sqlLines) {
      const mine = js.byLine.get(row.budget_line_id);
      expect(mine).toBeDefined();
      expect(mine!.openCommittedCents).toBe(Number(row.open_committed_cents));
      expect(mine!.openExpectedCents).toBe(Number(row.open_expected_cents));
    }

    // The defect itself, pinned: the same reduction over only the first page —
    // all an un-paginated PostgREST read ever returned — under-reports what is
    // committed, which is the number a director reads as "still available".
    const truncated = summarizeCommitments(out.commitments.slice(0, CAP), byCommitment, out.today);
    expect(truncated.totals.openCommittedCents).not.toBe(js.totals.openCommittedCents);
  });
});
