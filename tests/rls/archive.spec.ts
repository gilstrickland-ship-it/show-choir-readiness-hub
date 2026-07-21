// ============================================================================
// archive.spec.ts — archived seasons are read-only (Constitution X, §9.4)
// ----------------------------------------------------------------------------
// Archiving a season freezes its season-scoped data: reads still work (the
// trophy-case / board-handoff vault), but writes are rejected. Note two shapes
// of rejection under RLS: an INSERT trips WITH CHECK → 42501; an UPDATE is
// filtered by USING and simply touches zero rows (a silent no-op is still a
// rejection). Program A carries the archived season; both shapes are asserted.
// ============================================================================

import { describe, test, expect } from 'vitest';
import { A } from './fixtures';
import { asUser, rlsSkipped, RLS_DENIED } from './harness';

const director = () => asUser(A.director);
const treasurer = () => asUser(A.treasurer);
const costume = () => asUser(A.costume);

describe.skipIf(rlsSkipped())('archived season', () => {
  describe('reads still succeed', () => {
    test('director reads the archived competition', async () => {
      expect(
        await director().count(`select 1 from competitions where id = $1`, [A.competitionArchived]),
      ).toBe(1);
    });

    test('director reads the archived costume set', async () => {
      expect(
        await director().count(`select 1 from costume_sets where id = $1`, [A.costumeSetArchived]),
      ).toBe(1);
    });

    test('treasurer reads the archived budget', async () => {
      expect(await treasurer().count(`select 1 from budgets where id = $1`, [A.budgetArchived])).toBe(1);
    });

    test('director reads the archived hosted event', async () => {
      expect(
        await director().count(`select 1 from hosted_events where id = $1`, [A.hostedEventArchived]),
      ).toBe(1);
    });
  });

  describe('writes are rejected', () => {
    test('inserting a competition into the archived season is denied', async () => {
      const err = await director().expectDenied(
        `insert into competitions (program_id, season_id, name) values ($1, $2, 'Nope')`,
        [A.program, A.seasonArchived],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('inserting a costume set into the archived season is denied', async () => {
      const err = await costume().expectDenied(
        `insert into costume_sets (program_id, season_id, name) values ($1, $2, 'Nope')`,
        [A.program, A.seasonArchived],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('inserting a budget into the archived season is denied', async () => {
      const err = await treasurer().expectDenied(
        `insert into budgets (program_id, season_id, name, status) values ($1, $2, 'Nope', 'draft')`,
        [A.program, A.seasonArchived],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('updating an archived competition touches zero rows (USING filters it out)', async () => {
      const res = await director().query(`update competitions set name = 'Changed' where id = $1`, [
        A.competitionArchived,
      ]);
      expect(res.rowCount).toBe(0);
    });

    test('inserting a hosted event into the archived season is denied', async () => {
      const err = await director().expectDenied(
        `insert into hosted_events (program_id, season_id, name) values ($1, $2, 'Nope')`,
        [A.program, A.seasonArchived],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('inserting a hosted school under the archived hosted event is denied', async () => {
      // Child tables freeze through the hosted_event's season (hosted_event_archived).
      const err = await director().expectDenied(
        `insert into hosted_schools (program_id, hosted_event_id, school_name) values ($1, $2, 'Nope HS')`,
        [A.program, A.hostedEventArchived],
      );
      expect(err.code).toBe(RLS_DENIED);
    });

    test('updating the archived hosted event touches zero rows (USING filters it out)', async () => {
      const res = await director().query(`update hosted_events set name = 'Changed' where id = $1`, [
        A.hostedEventArchived,
      ]);
      expect(res.rowCount).toBe(0);
    });
  });
});
