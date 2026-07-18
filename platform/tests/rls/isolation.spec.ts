// ============================================================================
// isolation.spec.ts — cross-tenant isolation (Constitution I)
// ----------------------------------------------------------------------------
// Enumerates EVERY table carrying a program_id from information_schema at
// runtime (so a table added later is covered automatically) and proves, for
// each, that program A's director:
//   * sees zero of program B's rows,
//   * sees exactly program A's rows (no leakage the other direction),
//   * cannot insert a row owned by program B (RLS WITH CHECK → 42501).
// A cross-program leak is the existential bug; this is the sweep that catches it.
// ============================================================================

import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { A, B } from './fixtures';
import { asUser, raw, rlsSkipped, RLS_DENIED } from './harness';

const tables: string[] = rlsSkipped()
  ? []
  : (
      await raw<{ table_name: string }>(`
        select table_name
        from information_schema.columns
        where table_schema = 'public' and column_name = 'program_id'
        order by table_name
      `)
    ).rows.map((r) => r.table_name);

const director = () => asUser(A.director);

describe.skipIf(rlsSkipped())('cross-tenant isolation sweep', () => {
  test('found the program-scoped tables', () => {
    // Sanity: the sweep is meaningful only if it actually enumerated the schema.
    expect(tables.length).toBeGreaterThanOrEqual(30);
  });

  test.each(tables)('%s — A director sees zero B rows', async (tbl) => {
    const seen = await director().count(`select 1 from ${tbl} where program_id = $1`, [B.program]);
    expect(seen).toBe(0);
  });

  test.each(tables)('%s — A director sees exactly A rows (no under/over-read)', async (tbl) => {
    const rawA = (await raw(`select 1 from ${tbl} where program_id = $1`, [A.program])).rowCount ?? 0;
    const visible = await director().count(`select 1 from ${tbl}`);
    expect(visible).toBe(rawA);
  });

  test.each(tables)('%s — A director cannot insert a B-owned row', async (tbl) => {
    const bRow = (await raw(`select * from ${tbl} where program_id = $1 limit 1`, [B.program])).rows[0] as
      | Record<string, unknown>
      | undefined;
    if (!bRow) return; // nothing seeded for this table — skip the write probe

    // Re-insert B's own row (all columns valid, program_id still = B) under A's
    // director. The only thing that can reject it is the RLS WITH CHECK. A fresh
    // id removes the PK as a confounding failure reason.
    const cols = Object.keys(bRow);
    const params = cols.map((k) => (k === 'id' ? randomUUID() : bRow[k]));
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `insert into ${tbl} (${cols.map((c) => `"${c}"`).join(', ')}) values (${placeholders.join(', ')})`;

    const err = await director().expectDenied(sql, params);
    expect(err.code).toBe(RLS_DENIED);
  });
});
