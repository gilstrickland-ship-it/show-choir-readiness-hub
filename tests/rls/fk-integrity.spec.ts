// ============================================================================
// fk-integrity.spec.ts — cross-program reference integrity (Constitution I)
// ----------------------------------------------------------------------------
// isolation.spec.ts proves a member cannot write a row OWNED by another program
// (RLS WITH CHECK on program_id). This suite proves the other half, which RLS
// alone cannot express: a row owned by MY program may not REFERENCE another
// program's rows.
//
// The gap that motivated it: every write policy validated has_role(program_id)
// and stopped there, so an insert of {program_id: mine, travel_group_id: yours}
// passed — the single-column FK only cared that the group existed. Such a row is
// invisible to the victim (their read policy filters on program_id) and
// undeletable by them (the write policy keys on MY program_id), while still
// occupying their unique indexes and blocking their parent deletes.
//
// Migration 0017 repoints every such edge at a composite (id, program_id) FK, so
// the ENGINE rejects the write. That matters more than an application check:
// the attack is reachable straight through PostgREST with the anon key, and the
// PDF/export builders run under the service role, which bypasses RLS entirely
// but never bypasses a foreign key.
//
// Two layers here:
//   1. STRUCTURAL — every edge the migration declares really carries a
//      two-column FK including program_id. Data-driven from the migration's own
//      edge list, so an edge added later is covered automatically.
//   2. BEHAVIORAL — representative poisoning attempts are actually rejected,
//      including as the SERVICE role (the RLS-bypassing path), plus a
//      same-program control proving the legitimate write still works.
// ============================================================================

import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { A, B } from './fixtures';
import { asService, raw, rlsSkipped } from './harness';

const FK_VIOLATION = '23503';

interface Edge {
  child: string;
  child_column: string;
  parent: string;
}

const edges: Edge[] = rlsSkipped()
  ? []
  : (await raw<Edge>(`select child, child_column, parent from private.cross_program_ref_edges() order by child, child_column`))
      .rows;

describe.skipIf(rlsSkipped())('cross-program reference integrity', () => {
  test('the migration declares a meaningful set of edges', () => {
    // Guard against the edge list silently emptying (a bad refactor would make
    // every structural assertion below vacuously pass).
    expect(edges.length).toBeGreaterThanOrEqual(50);
  });

  // --- 1. Structural -------------------------------------------------------
  test.each(edges.map((e) => [`${e.child}.${e.child_column} → ${e.parent}`, e] as const))(
    '%s is a composite FK including program_id',
    async (_label, e) => {
      const { rows } = await raw<{ cols: string[] }>(
        `
        -- ::text matters — array_agg over attname yields name[], which the
        -- driver hands back as a raw "{a,b}" string instead of an array.
        select array_agg(a.attname::text order by k.ord) as cols
        from pg_constraint c
        join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.conrelid = $1::regclass
          and c.contype = 'f'
          and c.confrelid = $2::regclass
        group by c.oid
        `,
        [e.child, e.parent],
      );

      // At least one FK from child→parent must span both the reference column
      // and program_id. (A table can hold several FKs to the same parent —
      // ledger_entries → competitions is one of them — so this is an `any`.)
      const composite = rows.find(
        (r) => r.cols.includes(e.child_column) && r.cols.includes('program_id'),
      );
      expect(composite, `no composite FK on ${e.child}(${e.child_column}, program_id)`).toBeDefined();
      expect(composite!.cols).toHaveLength(2);
    },
  );

  // --- 2. Behavioral -------------------------------------------------------
  // Each case: a row owned by program A pointing at one of program B's rows.
  // Run as the SERVICE role deliberately — it bypasses RLS, so a rejection here
  // proves the constraint holds on the path an attacker (or a service-role code
  // path with a missing filter) would actually take.

  test('travel_assignments cannot point at another program\'s bus', async () => {
    const err = await asService().expectDenied(
      `insert into travel_assignments (id, program_id, travel_group_id, student_id) values ($1, $2, $3, $4)`,
      [randomUUID(), A.program, B.travelGroupBus, A.student],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('travel_assignments cannot point at another program\'s student', async () => {
    const err = await asService().expectDenied(
      `insert into travel_assignments (id, program_id, travel_group_id, student_id) values ($1, $2, $3, $4)`,
      [randomUUID(), A.program, A.travelGroupBus, B.student],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('travel_chaperones cannot carry free text onto another program\'s bus', async () => {
    // The blast radius that made this urgent: name_override is arbitrary text
    // and the parent-packet PDF is built with a service-role client.
    const err = await asService().expectDenied(
      `insert into travel_chaperones (id, program_id, travel_group_id, name_override) values ($1, $2, $3, 'injected')`,
      [randomUUID(), A.program, B.travelGroupBus],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('attendance cannot point at another program\'s competition', async () => {
    const err = await asService().expectDenied(
      `insert into attendance (id, program_id, competition_id, student_id, status) values ($1, $2, $3, $4, 'expected')`,
      [randomUUID(), A.program, B.competition, A.student],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('ensemble_members cannot enrol another program\'s student', async () => {
    const err = await asService().expectDenied(
      `insert into ensemble_members (id, program_id, season_id, ensemble_id, student_id) values ($1, $2, $3, $4, $5)`,
      [randomUUID(), A.program, A.seasonActive, A.ensemble, B.student],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('ledger_entries cannot tag another program\'s competition', async () => {
    const err = await asService().expectDenied(
      `insert into ledger_entries (id, program_id, season_id, direction, amount_cents, entry_date, competition_id)
       values ($1, $2, $3, 'in', 100, current_date, $4)`,
      [randomUUID(), A.program, A.seasonActive, B.competition],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  test('share_links cannot point at another program\'s competition', async () => {
    // resource_id is polymorphic, so no FK can express it — 0017 enforces the
    // same rule with a BEFORE trigger that raises foreign_key_violation.
    const err = await asService().expectDenied(
      `insert into share_links (id, program_id, resource, resource_id, token_hash) values ($1, $2, 'itinerary', $3, 'poison-hash')`,
      [randomUUID(), A.program, B.competition],
    );
    expect(err.code).toBe(FK_VIOLATION);
  });

  // --- 3. Controls ---------------------------------------------------------
  // The constraints must not have made legitimate same-program writes fail.

  // A throwaway student of program A, so the controls never disturb the shared
  // seeded rows other suites assert against.
  async function tempStudentA(): Promise<string> {
    const id = randomUUID();
    await raw(
      `insert into students (id, program_id, first_name, last_name, status) values ($1, $2, 'Temp', 'Rider', 'active')`,
      [id, A.program],
    );
    return id;
  }

  test('a same-program assignment still succeeds', async () => {
    const student = await tempStudentA();
    const id = randomUUID();
    await raw(
      `insert into travel_assignments (id, program_id, travel_group_id, student_id) values ($1, $2, $3, $4)`,
      [id, A.program, A.travelGroupBus, student],
    );
    const { rowCount } = await raw(`select 1 from travel_assignments where id = $1`, [id]);
    expect(rowCount).toBe(1);
    await raw(`delete from travel_assignments where id = $1`, [id]);
    await raw(`delete from students where id = $1`, [student]);
  });

  test('one-room-one-bus still fires for a same-program double booking', async () => {
    // 0017 made this trigger SECURITY DEFINER: under invoker rights its parent
    // lookup returned NULL for a cross-tenant row and the invariant was skipped
    // entirely. It must still reject the ordinary same-program case — one bus
    // per trip, so a second bus on A's trip is the double booking.
    const student = await tempStudentA();
    const secondBus = randomUUID();
    const first = randomUUID();
    await raw(
      `insert into travel_groups (id, program_id, trip_id, kind, label) values ($1, $2, $3, 'bus', 'Bus 2')`,
      [secondBus, A.program, A.trip],
    );
    await raw(
      `insert into travel_assignments (id, program_id, travel_group_id, student_id) values ($1, $2, $3, $4)`,
      [first, A.program, A.travelGroupBus, student],
    );

    const err = await asService().expectDenied(
      `insert into travel_assignments (id, program_id, travel_group_id, student_id) values ($1, $2, $3, $4)`,
      [randomUUID(), A.program, secondBus, student],
    );
    expect(err.message).toMatch(/already|one/i);

    await raw(`delete from travel_assignments where id = $1`, [first]);
    await raw(`delete from travel_groups where id = $1`, [secondBus]);
    await raw(`delete from students where id = $1`, [student]);
  });
});
