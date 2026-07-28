-- ============================================================================
-- Platform — Commitments: the layer between planned and spent
-- ----------------------------------------------------------------------------
-- The ledger records money that HAS MOVED. A budget records what was PLANNED.
-- Nothing recorded what has been PROMISED — so "how much of the costume budget
-- is still free?" was unanswerable: a director read $4,000 planned minus $800
-- spent as $3,200 available, while $3,200 was already committed to a vendor.
--
--   Planned  →  Committed  →  Spent  →  Still available
--
-- That middle column is this whole file. Everything below serves it.
--
-- ONE MECHANISM, TWO SUBTYPES (spec 006 §2, decision D4). An inbound purchase
-- order is not a real accounting object: an encumbrance reserves SPENDING
-- AUTHORITY and has no revenue analogue, so an in/out toggle would teach a
-- director a false model. `kind` is therefore a subtype, never a direction:
--   spending  — we promised to pay a vendor. REDUCES still-available on its
--               budget line before any cash moves.
--   expected  — someone promised to pay us (district allocation, grant award,
--               sponsorship pledge, an invoice to another district that owes us
--               entry fees). Does NOT increase available budget until it
--               actually arrives; it is reported separately as expected.
-- The asymmetry is the accounting reality: you may not spend money you have
-- merely been promised.
--
-- TWO PURSES, NEVER MIXED (§3, decision D12). Every commitment carries exactly
-- one `funding_source` — `district` or `booster` — and the sequential number is
-- assigned per program PER FUNDING SOURCE. This is a legal constraint, not a
-- preference: a booster must never issue, or appear to issue, the district's
-- purchase order, tax ID, or sales-tax exemption (Ohio guidance, AVUHSD board
-- policy, and the Texas Comptroller each prohibit it by name). Numbering,
-- identity and tax treatment therefore never mix; only the REPORTING blends.
--
-- THE ROLE RELAXATION, STATED OUT LOUD (§4). Today every money write is
-- treasurer-only (Constitution V, segregation of duties). This file deliberately
-- widens CREATE to director/admin/treasurer while keeping approve/issue/close
-- treasurer-only, because the anti-fraud value of the entire feature is
-- requester ≠ approver — which a treasurer-only model would DEFEAT by forcing
-- the treasurer to raise the requests she then approves. Self-approval is the
-- exact failure mode NCES, NFHS, AVUHSD and Harvard's policy all prohibit, so
-- `approved_by <> requested_by` is enforced by the ENGINE (a CHECK constraint),
-- not by a form. The relaxation is recorded here, in the RLS suite
-- (tests/rls/commitments.spec.ts), and nowhere else is the ledger widened: money
-- that has MOVED is still treasurer-only, still void-only.
--
-- APPEND-ONLY, LIKE THE LEDGER (R2). The top finding in a real district audit
-- was literally "Purchase orders are being altered after the fact", and the
-- auditor's rule is that a modification is a NEW DOCUMENT. So the REQUEST is
-- frozen at insert — amount, shipping, tax, budget line, vendor, purpose,
-- need-by, funding source, kind, number, season — and a change is a REVISION
-- ROW carrying `revision_of_id`, which supersedes the original. The button may
-- still say "Change amount". Only the LIFECYCLE moves after insert, and every
-- lifecycle stamp is set once and never cleared. Enforced by a trigger
-- mirroring `enforce_ledger_void_only`, so no writer — not PostgREST, not the
-- service role, not a future server action — can route around it.
--
-- NO student_id, EVER (R8). A commitment ties to a budget line, which is a
-- program-wide purpose. Tying committed money to an individual student is the
-- private-benefit hazard that cost Capital Gymnastics (T.C. Memo 2013-193) its
-- exemption, and it is the same line this platform already drew by refusing
-- individual fundraising accounts. There is no column for it and there must
-- never be one.
--
-- TENANCY. Every reference is a composite (id, program_id) foreign key in
-- 0017's pattern, so a commitment can never point at another program's season,
-- budget line, or prior revision, and a ledger entry can never draw down another
-- program's commitment. The new edges join `private.cross_program_ref_edges()`
-- so the pre-flight report and the RLS suite's structural sweep pick them up
-- automatically. In-SEASON scoping (a budget line reached through category →
-- budget → budgets.season_id) is a trigger, because no foreign key can express
-- it — the same rule 0019 states for every ledger tag.
--
-- OUTCOMES A CALLER CAN TELL APART (0020's class `OC`, unused by PostgreSQL and
-- by PostgREST):
--   OC016  the commitment is not this program's, or not in this entry's season
--   OC020  a frozen column was changed — a change is a revision, not an edit
--   OC021  a lifecycle stamp cannot be changed or cleared once it is set
--   OC022  a commitment is born as a request; approval/issue/receipt/close are
--          later acts, never insert values
--   OC023  the approver may not be the requester (self-approval)
--   OC024  you may only record your own approval or receipt
--   OC025  that budget line is not on this commitment's season's budget
--   OC026  the row being revised is not this program's, or is no longer open
--   OC027  a revision must keep the original's kind, funding source and season
-- The 42501 role refusals are unchanged — they are the security boundary and
-- keep the standard insufficient_privilege code.
--
-- NO GENERATED COLUMN for amount + shipping + tax, deliberately. It would read
-- well, but `information_schema`-driven tooling (the isolation sweep re-inserts
-- a row it selected with `select *`) cannot write one back, and a schema that
-- breaks a tenant-isolation sweep to save an addition is a bad trade. The total
-- is stated where it is used, in SQL and in the TypeScript mirror, exactly as
-- every other money aggregate in this codebase already is.
--
-- IDEMPOTENT + RE-RUNNABLE, in 0017/0019's style: existence-checked DDL,
-- `drop policy if exists` before each policy, `create or replace` for every
-- function. Nothing is read destructively and nothing is deleted.
--
-- DEPLOYMENT. This migration adds tables and one nullable ledger column; it
-- rewrites `add_ledger_entry` with a twelfth parameter (the drawdown link), so
-- apply it BEFORE deploying the application code that passes that parameter.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  Enums
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commitment_kind') then
    create type commitment_kind as enum ('spending', 'expected');
  end if;

  if not exists (select 1 from pg_type where typname = 'commitment_funding_source') then
    create type commitment_funding_source as enum ('district', 'booster');
  end if;

  -- The lifecycle a district's purchasing manual describes, plus the two ends a
  -- document can reach without being fulfilled. `superseded` is what a revision
  -- does to the row it replaces (R2).
  if not exists (select 1 from pg_type where typname = 'commitment_status') then
    create type commitment_status as enum (
      'requested', 'approved', 'issued', 'partially_received', 'received',
      'closed', 'cancelled', 'superseded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'commitment_audit_action') then
    create type commitment_audit_action as enum (
      'create', 'approve', 'issue', 'receive', 'close', 'cancel', 'supersede',
      'update'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- §2  The tables
-- ----------------------------------------------------------------------------
-- Read the column list as three groups, because the trigger in §5 does:
--   IDENTITY + MONEY — frozen at insert. A change is a revision row.
--   LIFECYCLE        — set once, never cleared, treasurer only.
--   REFERENCES       — the district's own PO number, a quote, board minutes, a
--                      note. Attachments to the document, freely editable by the
--                      treasurer and recorded in commitment_audit.

create table if not exists commitments (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  season_id      uuid not null,

  kind           commitment_kind not null default 'spending',
  funding_source commitment_funding_source not null,

  -- Sequential per program PER FUNDING SOURCE, assigned by the trigger in §4 and
  -- never accepted from a form. `revision` is 0 for an original and one higher
  -- than its parent for each revision, so "PO 1042 · rev 2" keeps the identity
  -- of the document while the modification is genuinely a separate row.
  number         integer not null,
  revision       integer not null default 0,
  revision_of_id uuid,

  vendor         text not null,
  purpose        text not null,
  amount_cents   bigint not null check (amount_cents > 0),
  -- Omitting shipping and tax is the documented top cause of invoice > PO, so
  -- they are their own columns rather than folded into the amount: the gap is
  -- the diagnostic. Committed total = amount + shipping + tax.
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  tax_cents      bigint not null default 0 check (tax_cents >= 0),

  -- Load-bearing (§6): no line, no encumbrance, no math. NOT NULL on purpose.
  budget_line_id uuid not null,
  need_by        date,

  status         commitment_status not null default 'requested',

  -- R6: after-the-fact commitments are allowed but MARKED, in neutral copy
  -- ("Recorded after the purchase"). This is the single most valuable number on
  -- a board snapshot and the #1 documented policy violation.
  after_the_fact boolean not null default false,

  -- R10: track the district's own PO number; never generate a document a vendor
  -- is asked to honour. `quote_path` / `board_minutes_ref` are the
  -- above-threshold attachments (D6).
  external_ref       text,
  quote_path         text,
  board_minutes_ref  text,
  note               text,

  requested_by   uuid not null references profiles(id),
  requested_at   timestamptz not null default now(),
  approved_by    uuid references profiles(id),
  approved_at    timestamptz,
  issued_at      timestamptz,
  received_at    timestamptz,
  received_by    uuid references profiles(id),

  -- R4: closing releases the remainder EXPLICITLY, with the released amount
  -- recorded. Never auto-close — silently re-inflating an available balance
  -- hides under-delivery.
  closed_at      timestamptz,
  close_reason   text,
  released_cents bigint check (released_cents is null or released_cents >= 0),

  cancelled_at   timestamptz,
  cancel_reason  text,
  superseded_at  timestamptz,

  created_at     timestamptz not null default now(),

  -- THE ANTI-FRAUD RULE, IN THE ENGINE. Not in the form, not in a server action:
  -- a constraint is the only layer no writer can route around, and it validates
  -- rows written before it existed.
  constraint commitments_no_self_approval
    check (approved_by is null or approved_by <> requested_by),
  -- An approval is a person and a moment together, or neither.
  constraint commitments_approval_complete
    check ((approved_at is null) = (approved_by is null)),
  constraint commitments_receipt_complete
    check ((received_at is null) = (received_by is null)),

  -- The three terminal states and their stamps are the same fact said twice, so
  -- the money math can key on the STAMPS (which are set-once and cannot be
  -- walked backwards) while the UI keys on the status.
  constraint commitments_closed_stamp
    check ((status = 'closed')     = (closed_at is not null)),
  constraint commitments_cancelled_stamp
    check ((status = 'cancelled')  = (cancelled_at is not null)),
  constraint commitments_superseded_stamp
    check ((status = 'superseded') = (superseded_at is not null)),

  constraint commitments_revision_shape
    check (revision >= 0 and (revision = 0) = (revision_of_id is null))
);

-- Identity key: required as the target of the composite foreign keys below
-- (redundant for uniqueness — id is already the primary key).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'commitments'::regclass and conname = 'uq_commitments_id_program'
  ) then
    alter table commitments add constraint uq_commitments_id_program unique (id, program_id);
  end if;
end
$$;

-- Tenant-carrying foreign keys (0017's mechanism). A commitment can never
-- reference another program's season, budget line, or prior revision.
do $$
declare
  e record;
begin
  for e in
    select * from (values
      ('season_id',      'seasons'),
      ('budget_line_id', 'budget_lines'),
      ('revision_of_id', 'commitments')
    ) as v(col, parent)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'commitments'::regclass
        and c.contype = 'f'
        and c.conname = format('commitments_%s_program_fkey', e.col)
    ) then
      execute format(
        'alter table commitments add constraint %I foreign key (%I, program_id) references %I (id, program_id)',
        format('commitments_%s_program_fkey', e.col), e.col, e.parent
      );
    end if;
  end loop;
end
$$;

-- Numbering is per program PER FUNDING SOURCE (§3) — a booster's #7 and the
-- district's #7 are different documents and must be able to coexist. `revision`
-- joins the key so a revision keeps its parent's number.
create unique index if not exists uq_commitments_number
  on commitments (program_id, funding_source, number, revision);

-- The revision chain does not fork: a given document is revised at most once,
-- and that revision may itself be revised. Without this, two concurrent "change
-- amount" presses would produce two live successors to one superseded row and
-- the committed total would double-count.
create unique index if not exists uq_commitments_one_revision_per_parent
  on commitments (revision_of_id) where revision_of_id is not null;

create index if not exists idx_commitments_program on commitments (program_id);
create index if not exists idx_commitments_season  on commitments (program_id, season_id);
create index if not exists idx_commitments_line    on commitments (budget_line_id);

-- Append-only audit trail, in ledger_audit's shape. Written ONLY by the §6
-- trigger (SECURITY DEFINER), which is why this table has no insert policy at
-- all: unlike ledger_audit, there is no path on which a client writes its own
-- audit row, so there is no reason to leave one open.
create table if not exists commitment_audit (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id),
  commitment_id uuid not null,
  action        commitment_audit_action not null,
  actor         uuid references profiles(id),
  diff          jsonb,
  at            timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'commitment_audit'::regclass
      and c.contype = 'f'
      and c.conname = 'commitment_audit_commitment_id_program_fkey'
  ) then
    alter table commitment_audit
      add constraint commitment_audit_commitment_id_program_fkey
      foreign key (commitment_id, program_id) references commitments (id, program_id);
  end if;
end
$$;

create index if not exists idx_commitment_audit_program on commitment_audit (program_id);
create index if not exists idx_commitment_audit_row     on commitment_audit (commitment_id);

-- ----------------------------------------------------------------------------
-- §3  The drawdown link on the ledger (R3)
-- ----------------------------------------------------------------------------
-- Linking a ledger entry to a commitment decrements the commitment's REMAINING
-- balance and leaves it open ("committed $3,200 · paid $3,050 · $150 still
-- committed"). Remaining is DERIVED — there is no stored paid_cents — so it can
-- never drift from the entries that produced it and there is no money column to
-- mutate. The column is nullable: every entry that has nothing to do with a
-- commitment carries NULL, and a composite foreign key is MATCH SIMPLE, so it is
-- simply not enforced there.

alter table ledger_entries add column if not exists commitment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'ledger_entries'::regclass
      and c.contype = 'f'
      and c.conname = 'ledger_entries_commitment_id_program_fkey'
  ) then
    alter table ledger_entries
      add constraint ledger_entries_commitment_id_program_fkey
      foreign key (commitment_id, program_id) references commitments (id, program_id);
  end if;
end
$$;

create index if not exists idx_ledger_entries_commitment
  on ledger_entries (commitment_id) where commitment_id is not null;

-- The new edges join the declarative list, so 0017's pre-flight report and the
-- RLS suite's structural sweep cover them without either being edited.
create or replace function private.cross_program_ref_edges()
returns table (child text, child_column text, parent text)
language sql immutable set search_path = public as $$
  select * from (values
    -- §3 roster
    ('guardians',             'student_id',       'students'),
    ('guardian_tokens',       'guardian_id',      'guardians'),
    ('ensemble_members',      'season_id',        'seasons'),
    ('ensemble_members',      'ensemble_id',      'ensembles'),
    ('ensemble_members',      'student_id',       'students'),
    -- §4 costumes
    ('costume_sets',          'season_id',        'seasons'),
    ('costume_sets',          'ensemble_id',      'ensembles'),
    ('costume_pieces',        'set_id',           'costume_sets'),
    ('costume_pieces',        'acquired_season_id','seasons'),
    ('costume_assignments',   'season_id',        'seasons'),
    ('costume_assignments',   'piece_id',         'costume_pieces'),
    ('costume_assignments',   'student_id',       'students'),
    ('costume_checkouts',     'competition_id',   'competitions'),
    ('costume_checkouts',     'assignment_id',    'costume_assignments'),
    ('costume_checkouts',     'piece_id',         'costume_pieces'),
    -- §5 competitions, itineraries, documents, attendance
    ('competitions',          'season_id',        'seasons'),
    ('competition_results',   'competition_id',   'competitions'),
    ('competition_ensembles', 'competition_id',   'competitions'),
    ('competition_ensembles', 'ensemble_id',      'ensembles'),
    ('attendance',            'competition_id',   'competitions'),
    ('attendance',            'student_id',       'students'),
    ('documents',             'competition_id',   'competitions'),
    ('packet_parses',         'competition_id',   'competitions'),
    ('packet_parses',         'document_id',      'documents'),
    ('itineraries',           'competition_id',   'competitions'),
    ('itinerary_items',       'itinerary_id',     'itineraries'),
    ('absence_requests',      'competition_id',   'competitions'),
    ('absence_requests',      'student_id',       'students'),
    ('absence_requests',      'guardian_id',      'guardians'),
    -- §5a events
    ('events',                'season_id',        'seasons'),
    ('event_ensembles',       'event_id',         'events'),
    ('event_ensembles',       'ensemble_id',      'ensembles'),
    -- §5b hosting (0011)
    ('hosted_events',         'season_id',        'seasons'),
    ('hosted_schools',        'hosted_event_id',  'hosted_events'),
    ('hosted_slots',          'hosted_event_id',  'hosted_events'),
    ('hosted_slots',          'hosted_school_id', 'hosted_schools'),
    -- §6 travel
    ('trips',                 'season_id',        'seasons'),
    ('trips',                 'competition_id',   'competitions'),
    ('travel_groups',         'trip_id',          'trips'),
    ('travel_assignments',    'travel_group_id',  'travel_groups'),
    ('travel_assignments',    'student_id',       'students'),
    ('travel_chaperones',     'travel_group_id',  'travel_groups'),
    ('travel_chaperones',     'guardian_id',      'guardians'),
    -- §7 treasury
    ('budgets',               'season_id',        'seasons'),
    ('budget_categories',     'budget_id',        'budgets'),
    ('budget_lines',          'category_id',      'budget_categories'),
    ('ledger_entries',        'season_id',        'seasons'),
    ('ledger_entries',        'budget_line_id',   'budget_lines'),
    ('ledger_entries',        'competition_id',   'competitions'),
    ('ledger_entries',        'trip_id',          'trips'),
    ('ledger_audit',          'entry_id',         'ledger_entries'),
    -- §7a commitments (0021)
    ('commitments',           'season_id',        'seasons'),
    ('commitments',           'budget_line_id',   'budget_lines'),
    ('commitments',           'revision_of_id',   'commitments'),
    ('commitment_audit',      'commitment_id',    'commitments'),
    ('ledger_entries',        'commitment_id',    'commitments'),
    -- §8 comms
    ('shifts',                'season_id',        'seasons'),
    ('shifts',                'competition_id',   'competitions'),
    ('shifts',                'trip_id',          'trips'),
    ('shifts',                'event_id',         'events'),
    ('shift_signups',         'shift_id',         'shifts'),
    ('shift_signups',         'guardian_id',      'guardians'),
    ('announcements',         'season_id',        'seasons'),
    ('announcements',         'ensemble_id',      'ensembles'),
    ('announcement_sends',    'announcement_id',  'announcements'),
    ('digest_sends',          'digest_id',        'digests')
  ) as e(child, child_column, parent)
$$;

-- ----------------------------------------------------------------------------
-- §4  Numbering, revisions, and the in-season rule — one BEFORE INSERT trigger
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER for the reason 0017 §5 gives: a trigger that computes its
-- answer from a SELECT the caller cannot see quietly produces the WRONG answer
-- rather than an error. Under invoker rights the `max(number)` below would be
-- filtered by the caller's RLS, so a seat that could insert but not read would
-- restart numbering at 1 and collide.
--
-- The advisory lock serialises numbering per (program, funding source) for the
-- rest of the transaction. Without it two concurrent requests read the same max
-- and one loses to the unique index with a bare 23505 — a friendly-looking
-- feature failing for a reason no treasurer could act on.

create or replace function public.assign_commitment_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent commitments%rowtype;
begin
  -- A commitment is BORN A REQUEST. Approval, issue, receipt and closure are
  -- later acts performed by the treasurer through an UPDATE (which RLS gates on
  -- the treasurer role); accepting them as insert values would let a director
  -- who may create a request also forge its approval in the same statement.
  if new.approved_by is not null or new.approved_at is not null
     or new.issued_at is not null or new.received_at is not null
     or new.received_by is not null or new.closed_at is not null
     or new.released_cents is not null or new.cancelled_at is not null
     or new.superseded_at is not null or new.status <> 'requested'
  then
    raise exception 'a commitment starts as a request — approval, issue, receipt and closing come later'
      using errcode = 'OC022';
  end if;

  -- The requester is WHO IS ASKING, never who the form said. Stamped rather
  -- than validated so it cannot be forged at all; a service-role writer (seeds,
  -- imports) has no auth.uid() and keeps the value it supplied.
  if auth.uid() is not null then
    new.requested_by := auth.uid();
  end if;

  -- The budget line must be on THIS commitment's season's budget. The composite
  -- foreign key proves the program; only a join through category → budget can
  -- prove the season, which is why this is a trigger (the same rule 0019
  -- restates for every ledger tag).
  if not exists (
    select 1
    from budget_lines bl
    join budget_categories bc on bc.id = bl.category_id
    join budgets b            on b.id  = bc.budget_id
    where bl.id = new.budget_line_id
      and bl.program_id = new.program_id
      and b.season_id   = new.season_id
  ) then
    raise exception 'that budget line is not on this season''s budget' using errcode = 'OC025';
  end if;

  if new.revision_of_id is null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.program_id::text || ':' || new.funding_source::text, 0)
    );
    new.number := coalesce(
      (select max(c.number) from commitments c
        where c.program_id = new.program_id
          and c.funding_source = new.funding_source),
      0
    ) + 1;
    new.revision := 0;
  else
    select * into parent
    from commitments c
    where c.id = new.revision_of_id and c.program_id = new.program_id
    for update;

    if parent.id is null then
      raise exception 'the commitment being revised is not this program''s' using errcode = 'OC026';
    end if;
    if parent.closed_at is not null or parent.cancelled_at is not null
       or parent.superseded_at is not null then
      raise exception 'that commitment is closed, cancelled or already revised — there is nothing to revise'
        using errcode = 'OC026';
    end if;
    -- A revision is the SAME DOCUMENT restated. Changing what purse it comes
    -- out of, or which subtype it is, is not a revision — it is a different
    -- commitment, and letting it masquerade as one would move a booster's
    -- spending under the district's numbering (§3, the legal constraint).
    if new.funding_source <> parent.funding_source
       or new.kind <> parent.kind
       or new.season_id <> parent.season_id then
      raise exception 'a revision keeps the original''s kind, funding source and season'
        using errcode = 'OC027';
    end if;
    -- Revising an APPROVED commitment is a change to an approved document, and
    -- the insert policy admits directors. Without this, a director could revise
    -- their own approved $500 request to $5,000 and the approval would ride
    -- along on a row nobody re-approved. Once it is approved, only the treasurer
    -- may restate it.
    if parent.approved_at is not null
       and auth.uid() is not null
       and not private.ledger_may_write(new.program_id) then
      raise exception 'only the treasurer changes an approved commitment' using errcode = '42501';
    end if;

    new.number   := parent.number;
    new.revision := parent.revision + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commitments_number on commitments;
create trigger trg_commitments_number
  before insert on commitments
  for each row execute function public.assign_commitment_number();

-- ----------------------------------------------------------------------------
-- §5  Append-only: the request is frozen, only the lifecycle moves (R2)
-- ----------------------------------------------------------------------------
-- Mirrors enforce_ledger_void_only. Every column that describes WHAT WAS
-- PROMISED is immutable after insert — a change is a revision row. Every
-- lifecycle stamp is monotonic: null → a value, once, and never back.

create or replace function public.enforce_commitment_append_only()
returns trigger
language plpgsql
as $$
begin
  -- (1) Identity + money. "Purchase orders are being altered after the fact"
  -- was a real audit finding; the remedy is that a modification is a new
  -- document, not a rejected edit dialog.
  if  new.program_id     is distinct from old.program_id
   or new.season_id      is distinct from old.season_id
   or new.kind           is distinct from old.kind
   or new.funding_source is distinct from old.funding_source
   or new.number         is distinct from old.number
   or new.revision       is distinct from old.revision
   or new.revision_of_id is distinct from old.revision_of_id
   or new.vendor         is distinct from old.vendor
   or new.purpose        is distinct from old.purpose
   or new.amount_cents   is distinct from old.amount_cents
   or new.shipping_cents is distinct from old.shipping_cents
   or new.tax_cents      is distinct from old.tax_cents
   or new.budget_line_id is distinct from old.budget_line_id
   or new.need_by        is distinct from old.need_by
   or new.after_the_fact is distinct from old.after_the_fact
   or new.requested_by   is distinct from old.requested_by
   or new.requested_at   is distinct from old.requested_at
   or new.created_at     is distinct from old.created_at
  then
    raise exception
      'a commitment''s amount, vendor, purpose, line, dates and source are fixed once requested; record a revision instead'
      using errcode = 'OC020';
  end if;

  -- (2) Lifecycle stamps are set once and never cleared. Un-approving,
  -- re-approving with a different name, or re-opening a closed commitment would
  -- each silently re-inflate an available balance.
  if (old.approved_at   is not null and new.approved_at   is distinct from old.approved_at)
   or (old.approved_by  is not null and new.approved_by   is distinct from old.approved_by)
   or (old.issued_at    is not null and new.issued_at     is distinct from old.issued_at)
   or (old.received_at  is not null and new.received_at   is distinct from old.received_at)
   or (old.received_by  is not null and new.received_by   is distinct from old.received_by)
   or (old.closed_at    is not null and new.closed_at     is distinct from old.closed_at)
   or (old.close_reason is not null and new.close_reason  is distinct from old.close_reason)
   or (old.released_cents is not null and new.released_cents is distinct from old.released_cents)
   or (old.cancelled_at is not null and new.cancelled_at  is distinct from old.cancelled_at)
   or (old.cancel_reason is not null and new.cancel_reason is distinct from old.cancel_reason)
   or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
  then
    raise exception 'a commitment''s approval, issue, receipt and closing are recorded once and never rewritten'
      using errcode = 'OC021';
  end if;

  -- (3) An approval or a receipt records the person doing it. The CHECK already
  -- forbids the requester approving their own request; this forbids recording
  -- someone ELSE as the approver, which is the same fraud with a second name on
  -- it. A service-role writer has no auth.uid() and is not second-guessed here —
  -- it bypasses RLS by design and is not a seat a person holds.
  if auth.uid() is not null then
    if old.approved_by is null and new.approved_by is not null
       and new.approved_by <> auth.uid() then
      raise exception 'you can only record your own approval' using errcode = 'OC024';
    end if;
    if old.received_by is null and new.received_by is not null
       and new.received_by <> auth.uid() then
      raise exception 'you can only record your own receipt' using errcode = 'OC024';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commitments_append_only on commitments;
create trigger trg_commitments_append_only
  before update on commitments
  for each row execute function public.enforce_commitment_append_only();

-- ----------------------------------------------------------------------------
-- §6  The audit trail, and superseding the row a revision replaces
-- ----------------------------------------------------------------------------
-- Written by a trigger rather than by a caller, so a commitment can no more
-- exist without its audit row than a ledger entry can (0019's rule, reached a
-- different way: the ledger's writes go through a definer function, a
-- commitment's insert goes through RLS, and a trigger is the only place that
-- covers both).
--
-- The same trigger closes the revision loop. R2 says the original is superseded,
-- never edited — so inserting the revision IS what supersedes it, in the same
-- transaction, rather than a step a later caller has to remember.

create or replace function public.log_commitment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action commitment_audit_action;
  v_diff   jsonb;
begin
  if tg_op = 'INSERT' then
    insert into commitment_audit (program_id, commitment_id, action, actor, diff)
    values (
      new.program_id, new.id, 'create', auth.uid(),
      jsonb_build_object(
        'kind',           new.kind,
        'funding_source', new.funding_source,
        'number',         new.number,
        'revision',       new.revision,
        'vendor',         new.vendor,
        'purpose',        new.purpose,
        'amount_cents',   new.amount_cents,
        'shipping_cents', new.shipping_cents,
        'tax_cents',      new.tax_cents,
        'budget_line_id', new.budget_line_id,
        'need_by',        new.need_by,
        'after_the_fact', new.after_the_fact,
        'revises',        new.revision_of_id
      )
    );

    if new.revision_of_id is not null then
      update commitments
         set status = 'superseded', superseded_at = now()
       where id = new.revision_of_id
         and program_id = new.program_id
         and superseded_at is null;
    end if;

    return new;
  end if;

  -- UPDATE: name the act, and record what changed. The order matters only in
  -- that the most significant transition wins the label; `diff` carries the
  -- whole change either way.
  if      old.approved_at   is null and new.approved_at   is not null then v_action := 'approve';
  elsif   old.issued_at     is null and new.issued_at     is not null then v_action := 'issue';
  elsif   old.received_at   is null and new.received_at   is not null then v_action := 'receive';
  elsif   old.closed_at     is null and new.closed_at     is not null then v_action := 'close';
  elsif   old.cancelled_at  is null and new.cancelled_at  is not null then v_action := 'cancel';
  elsif   old.superseded_at is null and new.superseded_at is not null then v_action := 'supersede';
  else                                                                     v_action := 'update';
  end if;

  v_diff := jsonb_strip_nulls(jsonb_build_object(
    'status',            case when new.status is distinct from old.status then new.status end,
    'approved_by',       case when new.approved_by is distinct from old.approved_by then new.approved_by end,
    'released_cents',    case when new.released_cents is distinct from old.released_cents then new.released_cents end,
    'close_reason',      case when new.close_reason is distinct from old.close_reason then new.close_reason end,
    'cancel_reason',     case when new.cancel_reason is distinct from old.cancel_reason then new.cancel_reason end,
    'external_ref',      case when new.external_ref is distinct from old.external_ref then new.external_ref end,
    'quote_path',        case when new.quote_path is distinct from old.quote_path then new.quote_path end,
    'board_minutes_ref', case when new.board_minutes_ref is distinct from old.board_minutes_ref then new.board_minutes_ref end,
    'note',              case when new.note is distinct from old.note then new.note end
  ));

  -- A no-op UPDATE (a form resubmitted with nothing changed) is not an event.
  if v_action = 'update' and v_diff = '{}'::jsonb then
    return new;
  end if;

  insert into commitment_audit (program_id, commitment_id, action, actor, diff)
  values (new.program_id, new.id, v_action, auth.uid(), v_diff);

  return new;
end;
$$;

drop trigger if exists trg_commitments_audit on commitments;
create trigger trg_commitments_audit
  after insert or update on commitments
  for each row execute function public.log_commitment_change();

-- ----------------------------------------------------------------------------
-- §7  RLS
-- ----------------------------------------------------------------------------

alter table commitments      enable row level security;
alter table commitment_audit enable row level security;

-- Who may raise a request. THE DELIBERATE RELAXATION (see the header): a
-- director or admin may ask; only the treasurer may approve, issue, receive and
-- close. Defined as a named function so the widening is one auditable place
-- rather than an array repeated across policies.
create or replace function private.commitment_may_create(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_role(
           pid,
           array['director','admin','treasurer']::program_member_role[]
         )
$$;

-- A POLICY PREDICATE IS EVALUATED AS THE QUERYING USER, so unlike the SECURITY
-- DEFINER helpers in 0019 — which are only ever reached from inside another
-- definer function — this one has to be executable by `authenticated` or the
-- policy that names it fails closed for everyone with "permission denied for
-- function". Revoked from PUBLIC (and so from anon) and granted back to exactly
-- the one role that needs it; it answers a question about the CALLER and leaks
-- nothing about the program either way.
revoke execute on function private.commitment_may_create(uuid) from public, anon;
grant  execute on function private.commitment_may_create(uuid) to authenticated;

drop policy if exists commitments_read on commitments;
create policy commitments_read on commitments for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );

-- The time-boxed, consent-gated Octv support read (0004), in the same shape as
-- every other program-scoped table. Without it the support view would show a
-- committed TOTAL (the aggregates in §8 admit support) over a list it could not
-- read — a worse state than either answer alone.
drop policy if exists commitments_support_read on commitments;
create policy commitments_support_read on commitments for select to authenticated
  using ( private.is_support_active(program_id) );

drop policy if exists commitments_insert on commitments;
create policy commitments_insert on commitments for insert to authenticated
  with check ( private.commitment_may_create(program_id)
               and not private.season_archived(season_id) );

-- Approve / issue / receive / close / cancel are all UPDATEs, and all treasurer.
-- The §5 trigger governs WHAT may change; this governs WHO. Written as
-- `private.has_role(...)` rather than `private.ledger_may_write(...)` — the same
-- rule, but 0019's helper is not executable by `authenticated` (see above), and
-- a policy may only call what the querying user may call. Money that has MOVED
-- and money that is PROMISED are gated by the same seat either way.
drop policy if exists commitments_update on commitments;
create policy commitments_update on commitments for update to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) );

-- No delete policy, deliberately. A commitment is cancelled or closed, never
-- removed — the same posture as a ledger entry (§6 "deliberately absent: hard
-- delete").

drop policy if exists commitment_audit_read on commitment_audit;
create policy commitment_audit_read on commitment_audit for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );

drop policy if exists commitment_audit_support_read on commitment_audit;
create policy commitment_audit_support_read on commitment_audit for select to authenticated
  using ( private.is_support_active(program_id) );

-- No insert/update/delete policies on commitment_audit at all: it is written by
-- the §6 definer trigger and by nothing else.

-- ----------------------------------------------------------------------------
-- §8  The available-balance math — in SQL, so no row cap can reach it
-- ----------------------------------------------------------------------------
-- The 0019 lesson, restated: PostgREST caps a response at `max_rows`, so any
-- total summed in JavaScript over a fetched list silently under-reports past
-- that cap. These return ONE ROW (and one row per budget line), so
-- Planned → Committed → Spent → Still available cannot depend on how many rows
-- the API was willing to hand back.
--
-- The read gate is `private.ledger_may_read` — the same treasury read matrix
-- plus the consent-gated support read that every other money figure uses. One
-- gate, so a seat cannot see a committed total it could not see the entries
-- behind.
--
-- DEFINITIONS, stated once here and mirrored field-for-field in lib/treasury
-- (`summarizeCommitments`) for the one service-role path that cannot call them:
--   total      = amount_cents + shipping_cents + tax_cents
--   drawn      = live ledger entries linked to it, in the direction its kind
--                means (out for spending, in for expected) — a misdirected
--                entry never draws down a commitment it does not belong to
--   remaining  = greatest(total − drawn, 0)   (overspend WARNS, never blocks —
--                R5 — so it shows as zero remaining plus an overspent count)
--   open       = not closed, not cancelled, not superseded
--   standing   = not cancelled, not superseded (a closed document is still a
--                fact about the season; a superseded one has been replaced by
--                its revision and counting both would double)

create or replace function private.commitment_drawdown(p_program_id uuid, p_season_id uuid)
returns table (
  commitment_id  uuid,
  kind           commitment_kind,
  budget_line_id uuid,
  total_cents    bigint,
  drawn_cents    bigint,
  remaining_cents bigint,
  is_open        boolean,
  is_standing    boolean,
  need_by        date,
  after_the_fact boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select e.commitment_id,
           coalesce(sum(e.amount_cents) filter (where e.direction = 'out'), 0)::bigint as out_cents,
           coalesce(sum(e.amount_cents) filter (where e.direction = 'in'),  0)::bigint as in_cents
      from ledger_entries e
     where e.program_id = p_program_id
       and e.season_id  = p_season_id
       and e.voided_at is null
       and e.commitment_id is not null
     group by e.commitment_id
  )
  select c.id,
         c.kind,
         c.budget_line_id,
         (c.amount_cents + c.shipping_cents + c.tax_cents)::bigint,
         coalesce(case when c.kind = 'spending' then p.out_cents else p.in_cents end, 0)::bigint,
         greatest(
           (c.amount_cents + c.shipping_cents + c.tax_cents)
             - coalesce(case when c.kind = 'spending' then p.out_cents else p.in_cents end, 0),
           0
         )::bigint,
         (c.closed_at is null and c.cancelled_at is null and c.superseded_at is null),
         (c.cancelled_at is null and c.superseded_at is null),
         c.need_by,
         c.after_the_fact
    from commitments c
    left join paid p on p.commitment_id = c.id
   where c.program_id = p_program_id
     and c.season_id  = p_season_id
$$;

revoke execute on function private.commitment_drawdown(uuid, uuid) from public, anon;

drop function if exists public.commitment_totals(uuid, uuid);

create function public.commitment_totals(
  p_program_id uuid,
  p_season_id  uuid
)
returns table (
  open_committed_cents  bigint,
  open_expected_cents   bigint,
  committed_gross_cents bigint,
  drawn_cents           bigint,
  open_count            bigint,
  expected_count        bigint,
  stale_count           bigint,
  overspent_count       bigint,
  after_the_fact_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date;
begin
  if not private.ledger_may_read(p_program_id) then
    raise exception 'no money access in this program' using errcode = '42501';
  end if;

  -- "Overdue" is a calendar judgement, and a calendar belongs to the program,
  -- not to the server (Constitution VII). A need-by of today is not late.
  select (now() at time zone pr.timezone)::date into v_today
    from programs pr where pr.id = p_program_id;
  v_today := coalesce(v_today, current_date);

  return query
  select
    coalesce(sum(d.remaining_cents) filter (where d.is_open and d.kind = 'spending'), 0)::bigint,
    coalesce(sum(d.remaining_cents) filter (where d.is_open and d.kind = 'expected'), 0)::bigint,
    coalesce(sum(d.total_cents)     filter (where d.is_open and d.kind = 'spending'), 0)::bigint,
    coalesce(sum(d.drawn_cents)     filter (where d.is_open and d.kind = 'spending'), 0)::bigint,
    count(*) filter (where d.is_open and d.kind = 'spending')::bigint,
    count(*) filter (where d.is_open and d.kind = 'expected')::bigint,
    count(*) filter (where d.is_open and d.need_by is not null and d.need_by < v_today)::bigint,
    count(*) filter (where d.is_standing and d.drawn_cents > d.total_cents)::bigint,
    count(*) filter (where d.is_standing and d.after_the_fact)::bigint
  from private.commitment_drawdown(p_program_id, p_season_id) d;
end;
$$;

drop function if exists public.commitment_line_totals(uuid, uuid);

create function public.commitment_line_totals(
  p_program_id uuid,
  p_season_id  uuid
)
returns table (
  budget_line_id       uuid,
  open_committed_cents bigint,
  open_expected_cents  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.ledger_may_read(p_program_id) then
    raise exception 'no money access in this program' using errcode = '42501';
  end if;

  -- One row per budget line that carries an open commitment — bounded by the
  -- number of lines a program has written, which is the same bound as the line
  -- list the pages calling this already render.
  return query
  select d.budget_line_id,
         coalesce(sum(d.remaining_cents) filter (where d.kind = 'spending'), 0)::bigint,
         coalesce(sum(d.remaining_cents) filter (where d.kind = 'expected'), 0)::bigint
    from private.commitment_drawdown(p_program_id, p_season_id) d
   where d.is_open
   group by d.budget_line_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- §9  The ledger, taught about the link
-- ----------------------------------------------------------------------------
-- Three existing objects have to learn `commitment_id` or they become holes:
--
--   (1) enforce_ledger_void_only — the void-only trigger froze every financial
--       column on UPDATE. A column it does not name is a column a treasurer can
--       rewrite on a live entry, and moving a payment from one purchase order to
--       another after the fact is precisely the alteration this whole feature
--       exists to make impossible.
--   (2) add_ledger_entry — gains a twelfth parameter, resolved in-program AND
--       in-season like every other tag (0019's rule: a previous season's tag
--       booked onto a current-season entry is frozen there forever).
--   (3) categorize_ledger_entry — files an entry by voiding it and writing a
--       replacement. A replacement that dropped the commitment link would
--       silently release money back into the available balance, which is the
--       same class of defect as dropping the receipt.

create or replace function public.enforce_ledger_void_only()
returns trigger
language plpgsql
as $$
begin
  if  new.program_id     is distinct from old.program_id
   or new.season_id      is distinct from old.season_id
   or new.entry_date     is distinct from old.entry_date
   or new.direction      is distinct from old.direction
   or new.amount_cents   is distinct from old.amount_cents
   or new.budget_line_id is distinct from old.budget_line_id
   or new.competition_id is distinct from old.competition_id
   or new.trip_id        is distinct from old.trip_id
   or new.commitment_id  is distinct from old.commitment_id
   or new.memo           is distinct from old.memo
   or new.counterparty   is distinct from old.counterparty
   or new.receipt_path   is distinct from old.receipt_path
   or new.entered_by     is distinct from old.entered_by
   or new.created_at     is distinct from old.created_at
  then
    raise exception
      'ledger entries are immutable except voiding; correct via void + re-enter';
  end if;

  if old.voided_at is not null and new.voided_at is null then
    raise exception 'a voided ledger entry cannot be un-voided';
  end if;

  return new;
end;
$$;

-- The eleven-parameter version is dropped rather than overloaded: PostgREST
-- calls by NAME, and two candidates differing only by a defaulted trailing
-- argument would be ambiguous.
drop function if exists public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
);

create or replace function public.add_ledger_entry(
  p_program_id     uuid,
  p_season_id      uuid,
  p_entry_date     date,
  p_direction      ledger_entry_direction,
  p_amount_cents   bigint,
  p_budget_line_id uuid    default null,
  p_competition_id uuid    default null,
  p_trip_id        uuid    default null,
  p_memo           text    default null,
  p_counterparty   text    default null,
  p_receipt_path   text    default null,
  p_commitment_id  uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not private.ledger_may_write(p_program_id) then
    raise exception 'only the treasurer records money' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'an entry needs an amount above zero' using errcode = 'OC010';
  end if;

  -- Season: ours, and not archived (mirrors ledger_entries_insert).
  if not exists (
    select 1 from seasons s
    where s.id = p_season_id and s.program_id = p_program_id and s.archived_at is null
  ) then
    raise exception 'that season is not this program''s, or is archived'
      using errcode = 'OC011';
  end if;

  -- Optional tags: ours AND this season's. budget_lines reach their season
  -- through category → budget → budgets.season_id.
  if p_budget_line_id is not null and not exists (
    select 1
    from budget_lines bl
    join budget_categories bc on bc.id = bl.category_id
    join budgets b            on b.id  = bc.budget_id
    where bl.id = p_budget_line_id
      and bl.program_id = p_program_id
      and b.season_id   = p_season_id
  ) then
    raise exception 'that budget line is not on this season''s budget'
      using errcode = 'OC012';
  end if;

  if p_competition_id is not null and not exists (
    select 1 from competitions c
    where c.id = p_competition_id
      and c.program_id = p_program_id
      and c.season_id  = p_season_id
  ) then
    raise exception 'that competition is not in this season' using errcode = 'OC013';
  end if;

  if p_trip_id is not null and not exists (
    select 1 from trips t
    where t.id = p_trip_id
      and t.program_id = p_program_id
      and t.season_id  = p_season_id
  ) then
    raise exception 'that trip is not in this season' using errcode = 'OC014';
  end if;

  -- The drawdown link (R3). Resolved exactly like the other three tags: a
  -- commitment from another program or another season would be frozen onto this
  -- entry by the void-only trigger and would decrement a balance on the wrong
  -- year's books. Any status is accepted — a late invoice against a closed
  -- purchase order is a real fact about the money, and only OPEN commitments are
  -- offered in the picker or counted as still committed.
  if p_commitment_id is not null and not exists (
    select 1 from commitments c
    where c.id = p_commitment_id
      and c.program_id = p_program_id
      and c.season_id  = p_season_id
  ) then
    raise exception 'that commitment is not in this season' using errcode = 'OC016';
  end if;

  insert into ledger_entries (
    program_id, season_id, entry_date, direction, amount_cents,
    budget_line_id, competition_id, trip_id, commitment_id, memo, counterparty,
    receipt_path, entered_by
  ) values (
    p_program_id, p_season_id, coalesce(p_entry_date, current_date), p_direction,
    p_amount_cents, p_budget_line_id, p_competition_id, p_trip_id, p_commitment_id,
    p_memo, p_counterparty, p_receipt_path, auth.uid()
  )
  returning id into v_id;

  insert into ledger_audit (program_id, entry_id, action, actor, diff)
  values (
    p_program_id, v_id, 'create', auth.uid(),
    jsonb_build_object(
      'direction',      p_direction,
      'amount_cents',   p_amount_cents,
      'entry_date',     coalesce(p_entry_date, current_date),
      'budget_line_id', p_budget_line_id,
      'competition_id', p_competition_id,
      'trip_id',        p_trip_id,
      'commitment_id',  p_commitment_id,
      'memo',           p_memo,
      'counterparty',   p_counterparty,
      'receipt_path',   p_receipt_path
    )
  );

  return v_id;
end;
$$;

create or replace function public.categorize_ledger_entry(
  p_entry_id       uuid,
  p_program_id     uuid,
  p_budget_line_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o ledger_entries%rowtype;
  v_new uuid;
begin
  if not private.ledger_may_write(p_program_id) then
    raise exception 'only the treasurer files an entry' using errcode = '42501';
  end if;
  if p_budget_line_id is null then
    raise exception 'pick a budget line' using errcode = 'OC015';
  end if;

  -- Lock the original so a concurrent void or a double submit cannot produce
  -- two replacements for one entry.
  select * into o
  from ledger_entries e
  where e.id = p_entry_id
    and e.program_id = p_program_id
  for update;

  if o.id is null then
    raise exception 'that entry is not this program''s' using errcode = 'OC001';
  end if;

  if o.budget_line_id is not null then
    raise exception 'that entry is already on a budget line' using errcode = 'OC002';
  end if;

  if o.voided_at is not null then
    if exists (
      select 1 from ledger_audit a
      where a.program_id = p_program_id
        and a.action = 'create'
        and a.diff ->> 'replaces' = p_entry_id::text
    ) then
      raise exception 'that entry was already filed onto a budget line'
        using errcode = 'OC002';
    end if;
    raise exception 'that entry is voided, so there is nothing to file'
      using errcode = 'OC003';
  end if;

  if private.season_archived(o.season_id) then
    raise exception 'that season is archived' using errcode = 'OC011';
  end if;

  -- The line must be ours AND on this entry's season's budget.
  if not exists (
    select 1
    from budget_lines bl
    join budget_categories bc on bc.id = bl.category_id
    join budgets b            on b.id  = bc.budget_id
    where bl.id = p_budget_line_id
      and bl.program_id = p_program_id
      and b.season_id   = o.season_id
  ) then
    raise exception 'that budget line is not on this season''s budget'
      using errcode = 'OC012';
  end if;

  update ledger_entries
     set voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = 'Put on a budget line (void + re-entry)'
   where id = o.id;

  insert into ledger_audit (program_id, entry_id, action, actor, diff)
  values (
    p_program_id, o.id, 'void', auth.uid(),
    jsonb_build_object('void_reason', 'Put on a budget line (void + re-entry)')
  );

  insert into ledger_entries (
    program_id, season_id, entry_date, direction, amount_cents,
    budget_line_id, competition_id, trip_id, commitment_id, memo, counterparty,
    receipt_path, entered_by
  ) values (
    p_program_id, o.season_id, o.entry_date, o.direction, o.amount_cents,
    p_budget_line_id, o.competition_id, o.trip_id, o.commitment_id, o.memo,
    o.counterparty, o.receipt_path, auth.uid()
  )
  returning id into v_new;

  insert into ledger_audit (program_id, entry_id, action, actor, diff)
  values (
    p_program_id, v_new, 'create', auth.uid(),
    jsonb_build_object(
      'direction',      o.direction,
      'amount_cents',   o.amount_cents,
      'entry_date',     o.entry_date,
      'budget_line_id', p_budget_line_id,
      'competition_id', o.competition_id,
      'trip_id',        o.trip_id,
      'commitment_id',  o.commitment_id,
      'memo',           o.memo,
      'counterparty',   o.counterparty,
      'receipt_path',   o.receipt_path,
      'replaces',       o.id
    )
  );

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- §10  Exposure
-- ----------------------------------------------------------------------------
-- 0007 grants routines broadly and sets default privileges that hand a
-- newly-created function to `anon`. A SECURITY DEFINER money function reachable
-- at /rest/v1/rpc/<name> by an unauthenticated caller is the defect 0018 exists
-- to clean up, so every function this file creates or replaces re-asserts its
-- ACL. The in-function guards remain the real control; the grant is defence in
-- depth, not the boundary.
--
-- The trigger functions are revoked from `authenticated` as well (0018's rule):
-- they are internal plumbing with no caller but the trigger system, which
-- invokes them irrespective of EXECUTE grants.

revoke execute on function public.assign_commitment_number()        from public, anon, authenticated;
revoke execute on function public.enforce_commitment_append_only()  from public, anon, authenticated;
revoke execute on function public.log_commitment_change()           from public, anon, authenticated;

-- private.commitment_drawdown RETURNS ROWS, which the other private helpers do
-- not — ledger_may_read and friends only answer a question about the caller. So
-- it is revoked from `authenticated` too, not just anon: 0007's default
-- privileges would otherwise leave every signed-in user able to read any
-- program's committed amounts by naming its id. public.commitment_totals reaches
-- it as the owner, after its own gate.
revoke execute on function private.commitment_drawdown(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.commitment_totals(uuid, uuid)      from public, anon;
revoke execute on function public.commitment_line_totals(uuid, uuid) from public, anon;
revoke execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text, uuid
) from public, anon;
revoke execute on function public.categorize_ledger_entry(uuid, uuid, uuid) from public, anon;

grant execute on function public.commitment_totals(uuid, uuid)      to authenticated;
grant execute on function public.commitment_line_totals(uuid, uuid) to authenticated;
grant execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text, uuid
) to authenticated;
grant execute on function public.categorize_ledger_entry(uuid, uuid, uuid) to authenticated;
