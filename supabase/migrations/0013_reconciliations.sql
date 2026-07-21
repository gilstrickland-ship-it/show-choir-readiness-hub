-- ============================================================================
-- Platform — Monthly ledger reconciliation record (Wave L)
-- ----------------------------------------------------------------------------
-- The missing money control. Booster embezzlement is a documented recurring
-- problem (NFHS); the standard safeguards are separation of duties (built —
-- treasurer-only writes, §7), full-board read transparency (built), and MONTHLY
-- RECONCILIATION against the bank statement (this migration). A row asserts, for
-- one program + month, "the ledger was compared to the bank statement and it
-- matched." It is a STATUS record, not money.
--
-- Constitution V (money tracked, never touched): this table holds no ledger data
-- and touches no ledger row — it records that a human reconciled a month. Writes
-- are treasurer-only, mirroring the ledger's write boundary. Both INSERT and
-- DELETE are permitted: un-marking a month is allowed because a reconciliation is
-- a reversible status assertion, not a financial fact. There is deliberately NO
-- update policy — a correction is delete + re-insert (same spirit as the ledger's
-- void + re-enter). Reads mirror the ledger's coarse read gate EXACTLY
-- (director/admin/treasurer/board_member — NOT costume_manager) so the board can
-- see how current the books are; that transparency is the treasurer's protection.
--
-- The RLS isolation suite re-derives this table automatically (it carries a
-- program_id).
-- ============================================================================

create table if not exists ledger_reconciliations (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  month          date not null, -- first day of the reconciled month (YYYY-MM-01)
  note           text,
  reconciled_by  uuid references profiles(id),
  created_at     timestamptz not null default now(),
  unique (program_id, month)
);

create index idx_ledger_reconciliations_program on ledger_reconciliations(program_id);

alter table ledger_reconciliations enable row level security;

-- Read: the treasury read gate exactly — mirrors ledger_entries_read (0002 §7).
create policy ledger_reconciliations_read on ledger_reconciliations for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );

-- Insert: treasurer only (segregation of duties, Constitution V).
create policy ledger_reconciliations_insert on ledger_reconciliations for insert to authenticated
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[]) );

-- Delete: treasurer only. Un-marking a month is a reversible status change, not a
-- money mutation — so unlike the ledger, delete is allowed (there is no update).
create policy ledger_reconciliations_delete on ledger_reconciliations for delete to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[]) );
