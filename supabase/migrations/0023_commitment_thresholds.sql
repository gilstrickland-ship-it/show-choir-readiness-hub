-- ============================================================================
-- Platform — Commitment thresholds: the three numbers a program sets (spec 006 D6)
-- ----------------------------------------------------------------------------
-- 0021 built the document and its lifecycle. What it did not build is the
-- POLICY every district and booster board actually writes down: how big a
-- purchase has to be before one signature stops being enough.
--
-- Real policies vary too much for a fixed ladder (a 400-student district and a
-- 40-student booster do not share a number) and too little to justify a rules
-- engine nobody would configure. So it is three numbers, per program:
--
--   second_approver_cents  — above this, ONE approval is not enough (default $250)
--   board_approval_cents   — above this, the board minutes must be recorded
--                            before the document may be issued (default $1,000)
--   three_quotes_cents     — above this, the app NUDGES for three quotes. Never
--                            blocks. (default $500)
--
-- THEY LIVE ON THE PROGRAMS ROW, not in a new table. `feature_overrides` is the
-- flag store and not a config bucket (0003 states that rule), so these get their
-- own columns in exactly 0003's and 0004's shape: `add column if not exists`
-- with a default, which Postgres 11+ applies as metadata — every existing
-- program is governed by the defaults the moment this runs, with no data
-- migration and no nullable "not set yet" state to reason about.
--
-- WHY A THRESHOLD IS NOT A CHECK CONSTRAINT. Every other rule in 0021 is
-- enforced by a constraint because it must be true FOREVER: a purchase order
-- whose approver was its requester is wrong the day it is written and wrong ten
-- years later. A threshold is not like that. It is mutable policy — a board
-- raises it from $250 to $500 in September — and a CHECK would retroactively
-- invalidate every document approved under the old number, which is exactly the
-- rewriting-of-history this feature exists to prevent. So the threshold is
-- enforced at the MOMENT OF THE ACT, by a BEFORE UPDATE trigger reading the
-- program's number as it stands right now, and the documents it has already let
-- through stay valid.
--
-- WHERE THE SECOND APPROVAL IS RECORDED. Not in a new column: in
-- `commitment_audit`, which is already the log of who did what to this document
-- and already append-only. A first approval is an ACT on the commitment that
-- changes none of its columns, which is precisely what an audit row is for. The
-- completing approval is the existing `approved_by`/`approved_at` stamp, so the
-- chain reads:
--
--   requested_by  →  commitment_audit(action='approve', actor=…)  →  approved_by
--
-- and `approved_by <> requested_by` (0021's CHECK) still guards the end of it.
-- The audit table gains no INSERT POLICY — 0021's invariant that no client
-- writes its own audit row is untouched. It gains one more SERVER-SIDE writer,
-- the SECURITY DEFINER function below, in the same way `add_ledger_entry` is the
-- only writer of a ledger audit row.
--
-- THE SECOND STATED RELAXATION (0021's header records the first). Recording the
-- FIRST of two approvals is open to director, admin, treasurer AND board_member
-- — a seat that is read-only everywhere else in the app. It is deliberate: in a
-- booster program the second signature IS the board, and a rule whose default no
-- real program can satisfy is a rule every program turns off. The widening is
-- narrow and mediated: it is reachable only through this one function, it can
-- never produce an approved commitment on its own (the COMPLETING approval is
-- still treasurer-only), and it can never be the requester's own.
--
-- OUTCOMES (0020's class `OC`):
--   OC028  over the second-approver amount and nobody else has approved it yet
--   OC029  over the board-approval amount and the board minutes are not recorded
--   OC030  you have already approved this one
--   OC031  that commitment is not waiting for an approval
--   OC011  that season is archived (0019's code, same meaning)
--   OC016  that commitment is not this program's (0021's code, same meaning)
--   OC023  the approver may not be the requester (0021's code, same meaning)
--
-- IDEMPOTENT + RE-RUNNABLE, in 0017/0019/0021's style. It adds columns and one
-- trigger; it REPLACES nothing that 0021 created, so the two files can be read
-- independently.
--
-- DEPLOYMENT. Apply AFTER 0021 and 0022 and BEFORE deploying the application
-- code that reads the three columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  The three numbers
-- ----------------------------------------------------------------------------
-- Integer cents, like every other money column in this schema. Zero means OFF,
-- and it is spelled zero rather than NULL so "no second approver required" is a
-- number a program chose rather than a value nobody ever set.

alter table programs
  add column if not exists commitment_second_approver_cents bigint not null default 25000;
alter table programs
  add column if not exists commitment_board_approval_cents  bigint not null default 100000;
alter table programs
  add column if not exists commitment_three_quotes_cents    bigint not null default 50000;

do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('programs_commitment_second_approver_nonneg', 'commitment_second_approver_cents'),
      ('programs_commitment_board_approval_nonneg',  'commitment_board_approval_cents'),
      ('programs_commitment_three_quotes_nonneg',    'commitment_three_quotes_cents')
    ) as t(cname, col)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'programs'::regclass and conname = v.cname
    ) then
      execute format(
        'alter table programs add constraint %I check (%I >= 0)', v.cname, v.col
      );
    end if;
  end loop;
end
$$;

comment on column programs.commitment_second_approver_cents is
  'Spec 006 D6: above this committed total a commitment needs two approvals. 0 = off.';
comment on column programs.commitment_board_approval_cents is
  'Spec 006 D6: above this committed total board_minutes_ref is required before issuing. 0 = off.';
comment on column programs.commitment_three_quotes_cents is
  'Spec 006 D6: above this committed total the app nudges for three quotes. Never blocks. 0 = off.';

-- No RLS change. `programs_read` already lets every member read their own
-- program's row (the treasurer has to be able to see the rule she is held to),
-- and `programs_write` already restricts the write to director/admin — which is
-- the right boundary by itself: a treasurer who could raise her own approval
-- threshold would have no threshold at all.

-- ----------------------------------------------------------------------------
-- §2  The thresholds, enforced at the moment of the act
-- ----------------------------------------------------------------------------
-- A BEFORE UPDATE trigger of its own rather than a change to 0021 §5's
-- append-only trigger: that one answers "may this column move at all", this one
-- answers "is this program's policy satisfied", and they are separate questions
-- with separate failure messages. Trigger names decide firing order and
-- `trg_commitments_append_only` sorts before `trg_commitments_thresholds`, so
-- the frozen-column refusal still wins when both apply.
--
-- SECURITY DEFINER for 0017 §5's stated reason: it computes its answer from
-- SELECTs (the program's numbers, the audit trail) that a caller's RLS could
-- filter, and a trigger that reads a filtered row set does not fail — it
-- silently returns the WRONG answer.
--
-- A SERVICE-ROLE WRITER IS NOT SECOND-GUESSED, exactly as 0021 §5 already
-- decided for the same reason: it has no auth.uid(), it bypasses RLS by design,
-- and an importer loading last year's approved purchase orders must not be told
-- that a policy written this year forbids them.

create or replace function public.enforce_commitment_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total     bigint;
  v_second    bigint;
  v_board     bigint;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_total := new.amount_cents + new.shipping_cents + new.tax_cents;

  select coalesce(p.commitment_second_approver_cents, 0),
         coalesce(p.commitment_board_approval_cents, 0)
    into v_second, v_board
    from programs p
   where p.id = new.program_id;

  -- (1) The second approver. Checked as the approval STAMP goes on, so the
  -- first approval — an audit row written by §3 — has to already be there, by
  -- somebody who is neither the requester nor the person approving now.
  if old.approved_at is null and new.approved_at is not null
     and coalesce(v_second, 0) > 0 and v_total > v_second
  then
    if not exists (
      select 1
        from commitment_audit a
       where a.program_id    = new.program_id
         and a.commitment_id = new.id
         and a.action        = 'approve'
         and a.actor is not null
         and a.actor <> new.requested_by
         and (new.approved_by is null or a.actor <> new.approved_by)
    ) then
      raise exception
        'this is over the amount this program allows on one approval — somebody else has to approve it first'
        using errcode = 'OC028';
    end if;
  end if;

  -- (2) Board approval. The board-minutes reference is a fact about a meeting
  -- that happened, so the app can only require that it be WRITTEN DOWN before
  -- the document is issued — which is the moment a vendor first sees it.
  if old.issued_at is null and new.issued_at is not null
     and coalesce(v_board, 0) > 0 and v_total > v_board
     and (new.board_minutes_ref is null or btrim(new.board_minutes_ref) = '')
  then
    raise exception
      'this is over the amount this program sends to the board — record the board minutes before issuing it'
      using errcode = 'OC029';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commitments_thresholds on commitments;
create trigger trg_commitments_thresholds
  before update on commitments
  for each row execute function public.enforce_commitment_thresholds();

-- ----------------------------------------------------------------------------
-- §3  Approving one — one entry point, whichever approval this is
-- ----------------------------------------------------------------------------
-- The server action calls this and nothing else, so the DATABASE decides
-- whether this press is the first of two or the one that approves the document.
-- A page that decided that for itself would be a second opinion about a rule the
-- trigger above already owns, and the two would eventually disagree.
--
--   'recorded' — the first of two approvals is in the audit trail; the
--                commitment is still a request.
--   'approved' — the commitment is approved, stamped with who and when.
--
-- ORDER IS FIXED AND THE TREASURER GOES LAST. When two approvals are required
-- the treasurer's is the completing one, so a program with a single treasurer
-- cannot strand a document by spending her signature on the first slot — an
-- audit row cannot be taken back, and OC030 would then leave the commitment
-- permanently unapprovable. Refusing her first press is the friendlier half of
-- the same rule.

create or replace function public.record_commitment_approval(
  p_program_id    uuid,
  p_commitment_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c            commitments%rowtype;
  v_actor      uuid := auth.uid();
  v_total      bigint;
  v_second     bigint;
  v_two        boolean;
  v_prior      boolean;
  v_treasurer  boolean;
begin
  if v_actor is null then
    raise exception 'an approval records who gave it' using errcode = 'OC031';
  end if;

  -- The seat. Read once, because the answer is needed twice below.
  v_treasurer := private.has_role(p_program_id, array['treasurer']::program_member_role[]);
  -- Director, admin, treasurer — or a board member, who may give the FIRST of
  -- two approvals and nothing else (see the header). Checked again, per branch,
  -- below: this is the outer door.
  if not (
    v_treasurer
    or private.has_role(
         p_program_id,
         array['director','admin','board_member']::program_member_role[]
       )
  ) then
    raise exception 'your seat does not approve spending in this program' using errcode = '42501';
  end if;

  -- Lock it: two people pressing Approve at the same moment must not both be
  -- told they were the first.
  select * into c
    from commitments
   where id = p_commitment_id and program_id = p_program_id
   for update;

  if c.id is null then
    raise exception 'that commitment is not this program''s' using errcode = 'OC016';
  end if;
  if private.season_archived(c.season_id) then
    raise exception 'that season is archived' using errcode = 'OC011';
  end if;
  if c.status <> 'requested' or c.closed_at is not null
     or c.cancelled_at is not null or c.superseded_at is not null then
    raise exception 'that commitment is not waiting for an approval' using errcode = 'OC031';
  end if;
  -- 0021's CHECK says the same thing about the completing approval. This says it
  -- about the first one too, which no constraint can see.
  if c.requested_by = v_actor then
    raise exception 'whoever raised a request cannot approve it' using errcode = 'OC023';
  end if;

  v_total := c.amount_cents + c.shipping_cents + c.tax_cents;
  select coalesce(p.commitment_second_approver_cents, 0) into v_second
    from programs p where p.id = p_program_id;
  v_two := coalesce(v_second, 0) > 0 and v_total > v_second;

  -- One signature is never enough twice.
  if exists (
    select 1 from commitment_audit a
     where a.program_id = p_program_id
       and a.commitment_id = c.id
       and a.action = 'approve'
       and a.actor = v_actor
  ) then
    raise exception 'you have already approved this one' using errcode = 'OC030';
  end if;

  select exists (
    select 1 from commitment_audit a
     where a.program_id = p_program_id
       and a.commitment_id = c.id
       and a.action = 'approve'
       and a.actor is not null
       and a.actor <> c.requested_by
  ) into v_prior;

  if v_two and not v_prior then
    if v_treasurer then
      raise exception
        'this is over the amount this program allows on one approval — somebody else has to approve it before you do'
        using errcode = 'OC028';
    end if;
    insert into commitment_audit (program_id, commitment_id, action, actor, diff)
    values (
      p_program_id, c.id, 'approve', v_actor,
      jsonb_build_object(
        'approval',        'first',
        'amount_cents',    v_total,
        'threshold_cents', v_second
      )
    );
    return 'recorded';
  end if;

  -- The completing approval. Treasurer only — money that has moved and money
  -- that is promised answer to the same seat (0021 §7).
  if not v_treasurer then
    raise exception 'only the treasurer approves a commitment' using errcode = '42501';
  end if;

  -- RLS does not apply inside a definer function, so every gate the
  -- commitments_update policy would have applied has been applied above by hand.
  -- The trigger in §2 and 0021's own two triggers still run.
  update commitments
     set status      = 'approved',
         approved_by = v_actor,
         approved_at = now()
   where id = c.id and program_id = p_program_id;

  return 'approved';
end;
$$;

-- ----------------------------------------------------------------------------
-- §4  Exposure (0018's rule, 0021 §10's practice)
-- ----------------------------------------------------------------------------
-- 0007's default privileges hand a newly-created function to `anon`. A SECURITY
-- DEFINER function that approves spending, reachable unauthenticated at
-- /rest/v1/rpc/, is the defect 0018 exists to clean up. The in-function guards
-- are the real control; the ACL is defence in depth.

revoke execute on function public.enforce_commitment_thresholds() from public, anon, authenticated;
revoke execute on function public.record_commitment_approval(uuid, uuid) from public, anon;
grant  execute on function public.record_commitment_approval(uuid, uuid) to authenticated;
