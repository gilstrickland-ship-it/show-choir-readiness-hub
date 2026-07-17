// ============================================================================
// tokens.spec.ts — anonymous visitors have no RLS surface (Constitution II)
// ----------------------------------------------------------------------------
// Parents are never users. The token-surface tables have NO policies attached
// `to anon`, so an anonymous connection reads zero rows and every write is
// denied (42501). Parent-originated writes in production flow through a
// service-role context whose capability allow-list is the real boundary — but
// the RLS floor must itself be closed to anon, which is what this proves.
// (Inserts use otherwise-valid rows so the denial is genuinely RLS, not a
// missing-column or FK error.)
// ============================================================================

import { describe, test, expect } from 'vitest';
import { A } from './fixtures';
import { asAnon, rlsSkipped, RLS_DENIED } from './harness';

const anon = () => asAnon();

const TOKEN_TABLES = [
  'shift_signups',
  'absence_requests',
  'guardian_tokens',
  'share_links',
  'token_events',
] as const;

const INSERTS: Record<(typeof TOKEN_TABLES)[number], [string, unknown[]]> = {
  shift_signups: [
    `insert into shift_signups (program_id, shift_id, name, status, source) values ($1, $2, 'Anon', 'confirmed', 'token_link')`,
    [A.program, A.shift],
  ],
  absence_requests: [
    `insert into absence_requests (program_id, competition_id, student_id, note, status) values ($1, $2, $3, 'anon', 'pending')`,
    [A.program, A.competition, A.student],
  ],
  guardian_tokens: [
    `insert into guardian_tokens (program_id, guardian_id, token_hash) values ($1, $2, 'anon-attempt-hash')`,
    [A.program, A.guardian],
  ],
  share_links: [
    `insert into share_links (program_id, resource, resource_id, token_hash) values ($1, 'itinerary', $2, 'anon-share-hash')`,
    [A.program, A.itinerary],
  ],
  token_events: [
    `insert into token_events (program_id, token_kind, token_id, action) values ($1, 'guardian', $2, 'view')`,
    [A.program, A.guardianToken],
  ],
};

describe.skipIf(rlsSkipped())('anonymous token surface', () => {
  test.each(TOKEN_TABLES)('anon reads zero rows from %s', async (tbl) => {
    expect(await anon().count(`select 1 from ${tbl}`)).toBe(0);
  });

  test.each(TOKEN_TABLES)('anon write to %s is denied', async (tbl) => {
    const [sql, params] = INSERTS[tbl];
    const err = await anon().expectDenied(sql, params);
    expect(err.code).toBe(RLS_DENIED);
  });
});
