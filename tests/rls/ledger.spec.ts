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
import { A } from './fixtures';
import { asUser, rlsSkipped, RLS_DENIED } from './harness';

const treasurer = () => asUser(A.treasurer);

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
