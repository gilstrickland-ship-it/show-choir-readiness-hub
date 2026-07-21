// ============================================================================
// roles.spec.ts — §2 role permission matrix (segregation of duties)
// ----------------------------------------------------------------------------
// The matrix (architecture-spec.md §2) is the fine-grained gate on top of coarse
// membership. Each assertion below maps to one matrix cell:
//   * Ledger write = treasurer ONLY (admin/board/director cannot).
//   * Roster write = director/admin (treasurer cannot).
//   * Costumes + attendance write = incl. costume_manager, but NOT competitions.
//   * board_member reads ledger + budgets, writes nothing.
//   * Treasury read excludes costume_manager entirely.
// ============================================================================

import { describe, test, expect } from 'vitest';
import { A } from './fixtures';
import { asUser, rlsSkipped, RLS_DENIED } from './harness';

const admin = () => asUser(A.admin);
const treasurer = () => asUser(A.treasurer);
const costume = () => asUser(A.costume);
const board = () => asUser(A.board);

const insertLedger: [string, unknown[]] = [
  `insert into ledger_entries (program_id, season_id, direction, amount_cents, entered_by, memo)
   values ($1, $2, 'out', 100, $3, 'test')`,
  [A.program, A.seasonActive, A.treasurer],
];

const insertStudent: [string, unknown[]] = [
  `insert into students (program_id, first_name, last_name) values ($1, 'Test', 'Student')`,
  [A.program],
];

const insertCompetition: [string, unknown[]] = [
  `insert into competitions (program_id, season_id, name) values ($1, $2, 'Test Comp')`,
  [A.program, A.seasonActive],
];

const insertCostumePiece: [string, unknown[]] = [
  `insert into costume_pieces (program_id, kind, label) values ($1, 'prop', 'Test Prop')`,
  [A.program],
];

const insertHostedEvent: [string, unknown[]] = [
  `insert into hosted_events (program_id, season_id, name) values ($1, $2, 'Test Invitational')`,
  [A.program, A.seasonActive],
];

// Reconciliation write = treasurer only (Wave L). A month distinct from the
// seeded 2026-06 row so unique(program_id, month) never confounds the probe.
const insertReconciliation: [string, unknown[]] = [
  `insert into ledger_reconciliations (program_id, month, reconciled_by) values ($1, '2026-03-01', $2)`,
  [A.program, A.treasurer],
];

describe.skipIf(rlsSkipped())('§2 role matrix', () => {
  describe('ledger write = treasurer only', () => {
    test('admin CANNOT insert ledger_entries', async () => {
      const err = await admin().expectDenied(...insertLedger);
      expect(err.code).toBe(RLS_DENIED);
    });

    test('treasurer CAN insert ledger_entries', async () => {
      expect(await treasurer().allows(...insertLedger)).toBe(true);
    });
  });

  describe('roster write = director/admin only', () => {
    test('treasurer CANNOT write students', async () => {
      const err = await treasurer().expectDenied(...insertStudent);
      expect(err.code).toBe(RLS_DENIED);
    });
  });

  describe('costume_manager scope', () => {
    test('costume_manager CAN write costume_pieces', async () => {
      expect(await costume().allows(...insertCostumePiece)).toBe(true);
    });

    test('costume_manager CAN edit attendance', async () => {
      const ok = await costume().allows(`update attendance set status = 'absent' where id = $1`, [
        A.attendance,
      ]);
      expect(ok).toBe(true);
    });

    test('costume_manager CANNOT write competitions', async () => {
      const err = await costume().expectDenied(...insertCompetition);
      expect(err.code).toBe(RLS_DENIED);
    });

    test('costume_manager CANNOT read budgets (treasury read excludes it)', async () => {
      expect(await costume().count(`select 1 from budgets where program_id = $1`, [A.program])).toBe(0);
      expect(await costume().count(`select 1 from ledger_entries where program_id = $1`, [A.program])).toBe(
        0,
      );
    });
  });

  describe('hosting write = director/admin only (Wave I)', () => {
    test('admin CAN insert hosted_events', async () => {
      expect(await admin().allows(...insertHostedEvent)).toBe(true);
    });

    test('treasurer CANNOT insert hosted_events', async () => {
      const err = await treasurer().expectDenied(...insertHostedEvent);
      expect(err.code).toBe(RLS_DENIED);
    });

    test('costume_manager CANNOT insert hosted_events', async () => {
      const err = await costume().expectDenied(...insertHostedEvent);
      expect(err.code).toBe(RLS_DENIED);
    });

    test('board reads hosting rows (read-only seat)', async () => {
      expect(
        await board().count(`select 1 from hosted_events where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
    });
  });

  describe('monthly reconciliation = treasurer writes, treasury readers read (Wave L)', () => {
    test('treasurer CAN insert a reconciliation', async () => {
      expect(await treasurer().allows(...insertReconciliation)).toBe(true);
    });

    test('treasurer CAN delete (un-mark) a reconciliation', async () => {
      const ok = await treasurer().allows(
        `delete from ledger_reconciliations where id = $1`,
        [A.ledgerReconciliation],
      );
      expect(ok).toBe(true);
    });

    test('admin CANNOT write a reconciliation (treasurer only)', async () => {
      const err = await admin().expectDenied(...insertReconciliation);
      expect(err.code).toBe(RLS_DENIED);
    });

    test('board CANNOT write but CAN read reconciliations', async () => {
      expect((await board().expectDenied(...insertReconciliation)).code).toBe(RLS_DENIED);
      expect(
        await board().count(`select 1 from ledger_reconciliations where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
    });

    test('costume_manager CANNOT read reconciliations (treasury read excludes it)', async () => {
      expect(
        await costume().count(`select 1 from ledger_reconciliations where program_id = $1`, [A.program]),
      ).toBe(0);
    });
  });

  describe('board_member = read money, write nothing', () => {
    test('board reads budgets + ledger', async () => {
      expect(
        await board().count(`select 1 from budgets where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
      expect(
        await board().count(`select 1 from ledger_entries where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
    });

    test('board writes nothing (students / ledger / competitions / costumes all denied)', async () => {
      expect((await board().expectDenied(...insertStudent)).code).toBe(RLS_DENIED);
      expect((await board().expectDenied(...insertLedger)).code).toBe(RLS_DENIED);
      expect((await board().expectDenied(...insertCompetition)).code).toBe(RLS_DENIED);
      expect((await board().expectDenied(...insertCostumePiece)).code).toBe(RLS_DENIED);
    });
  });
});
