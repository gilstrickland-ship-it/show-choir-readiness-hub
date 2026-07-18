// ============================================================================
// support.spec.ts — Octv support access (T030, §10)
// ----------------------------------------------------------------------------
// Support access is a DELIBERATE cross-tenant read path, gated by BOTH
// profiles.is_support AND time-boxed director consent (programs.support_access_
// until in the future). It is NEVER a write path. This spec proves the three
// guarantees the design rests on:
//   1. support + consent  → can READ the consenting program's rows;
//   2. support − consent  → sees ZERO rows of a non-consenting program;
//   3. support NEVER writes → every write is rejected, even with consent.
// Program A grants consent in the seed; program B does not.
// ============================================================================

import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { A, B, SUPPORT_USER } from './fixtures';
import { asUser, rlsSkipped, RLS_DENIED } from './harness';

const support = () => asUser(SUPPORT_USER);

describe.skipIf(rlsSkipped())('support access', () => {
  describe('support + consent → read the consenting program (A)', () => {
    test('reads the program row', async () => {
      expect(await support().count(`select 1 from programs where id = $1`, [A.program])).toBe(1);
    });

    test('reads roster (students)', async () => {
      expect(
        await support().count(`select 1 from students where program_id = $1`, [A.program]),
      ).toBe(1);
    });

    test('reads treasury (ledger_entries) — full read-only view', async () => {
      expect(
        await support().count(`select 1 from ledger_entries where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
    });

    test('reads competitions', async () => {
      expect(
        await support().count(`select 1 from competitions where program_id = $1`, [A.program]),
      ).toBeGreaterThan(0);
    });
  });

  describe('support − consent → blocked from the non-consenting program (B)', () => {
    test('sees zero of program B students', async () => {
      expect(
        await support().count(`select 1 from students where program_id = $1`, [B.program]),
      ).toBe(0);
    });

    test('sees zero of program B ledger', async () => {
      expect(
        await support().count(`select 1 from ledger_entries where program_id = $1`, [B.program]),
      ).toBe(0);
    });

    test('cannot even see the program B row', async () => {
      expect(await support().count(`select 1 from programs where id = $1`, [B.program])).toBe(0);
    });
  });

  describe('support NEVER writes — even the consenting program (A)', () => {
    test('cannot insert a student', async () => {
      const err = await support().expectDenied(
        `insert into students (program_id, first_name, last_name) values ($1, 'No', 'Write')`,
        [A.program],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('cannot update a student (USING filters it → zero rows touched)', async () => {
      const res = await support().query(
        `update students set first_name = 'Changed' where program_id = $1`,
        [A.program],
      );
      expect(res.rowCount).toBe(0);
    });

    test('cannot insert a ledger entry', async () => {
      const err = await support().expectDenied(
        `insert into ledger_entries (program_id, season_id, direction, amount_cents, entered_by, memo)
         values ($1, $2, 'out', 100, $3, 'nope')`,
        [A.program, A.seasonActive, SUPPORT_USER],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('cannot insert a competition', async () => {
      const err = await support().expectDenied(
        `insert into competitions (program_id, season_id, name) values ($1, $2, 'Nope')`,
        [A.program, A.seasonActive],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('cannot change program consent (support_access_until)', async () => {
      const res = await support().query(
        `update programs set support_access_until = now() + interval '30 days' where id = $1`,
        [A.program],
      );
      expect(res.rowCount).toBe(0);
    });
  });

  describe('consent is per-program (isolation holds)', () => {
    test('a fresh support insert cannot smuggle in a B-owned row either', async () => {
      const err = await support().expectDenied(
        `insert into students (id, program_id, first_name, last_name) values ($1, $2, 'X', 'Y')`,
        [randomUUID(), B.program],
      );
      expect(err.code).toBe(RLS_DENIED);
    });
  });
});
