-- ============================================================================
-- Platform — Tenant-carrying foreign keys (cross-program reference hardening)
-- ----------------------------------------------------------------------------
-- Closes a whole vulnerability class, not a single bug.
--
-- THE CLASS. Every program-scoped table carries a denormalized program_id plus
-- SINGLE-COLUMN foreign keys to other program-scoped tables. The RLS write
-- policies check only `has_role(row.program_id)` — they never check that the
-- REFERENCED row belongs to that same program. Because /launch lets any signed-
-- in user create a program and become its director, an attacker could stamp
-- THEIR program_id on a row whose foreign key points at ANOTHER program's
-- record. The result is a row that:
--
--   * the victim cannot SEE      — read policies filter on program_id,
--   * the victim cannot DELETE   — write policies key on the attacker's id,
--   * blocks the victim's writes — unique indexes are not RLS-filtered, so a
--                                  poisoned row permanently squats a key,
--   * blocks the victim's deletes— child-then-parent delete paths fail on the
--                                  invisible row's FK, with nothing surfaced,
--   * and reaches parent-facing PDFs/exports, because the service-role read
--     paths select children by parent id and bypass RLS entirely.
--
-- WHY THE DATABASE AND NOT JUST THE ACTIONS. The server actions in this same
-- change resolve every client-posted uuid inside the claimed program before
-- writing it, which is the layer that turns an attack into a friendly error
-- message. But actions are not the only writer: the service-role client (packet
-- parsing, exports, Inngest jobs, support tooling) bypasses RLS by design, and
-- PostgREST is reachable directly. A constraint is the only layer no writer can
-- route around, and unlike a policy predicate it also validates rows written
-- BEFORE it existed. Constitution I is non-negotiable, so it is enforced here.
--
-- THE MECHANISM. For every parent, add the redundant identity key
-- `unique (id, program_id)` — redundant for uniqueness (id is already the
-- primary key) but REQUIRED as a composite foreign-key target. Then repoint
-- each child's single-column FK at that pair, carrying the child's own
-- program_id into the reference. Postgres then makes a cross-program reference
-- literally unrepresentable. Nullable columns keep working untouched: a
-- composite FK is MATCH SIMPLE, so it is not enforced when any member column is
-- NULL — an untagged ledger entry, a label-only travel chaperone, an unattached
-- inbound document all still insert exactly as before.
--
-- No new indexes are needed. The child-insert lookup is served by the new
-- `unique (id, program_id)` key on the parent, and the parent-delete lookup is
-- served by the existing single-column child indexes (a b-tree on (trip_id)
-- answers `trip_id = $1 and program_id = $2` fine).
--
-- The edge list is declarative (private.cross_program_ref_edges) and drives
-- three things from one source of truth: the pre-flight report, the repoint
-- loop, and the RLS suite's structural sweep. Existing delete semantics are
-- read out of the catalog and preserved, so the two ON DELETE CASCADE edges
-- from 0016 stay cascading.
--
-- ORDER OF OPERATIONS (Constitution VIII — no half-migrated state):
--   §1  edge list + the operator's pre-flight report function
--   §2  ABORT if poisoned rows already exist (never delete user data)
--   §3  parent identity keys
--   §4  repoint every child FK to the composite pair
--   §5  travel assignment trigger — stop silently skipping its invariant
--   §6  share_links.resource_id — polymorphic, so a trigger not an FK
--
-- DEPLOYMENT. Run the pre-flight FIRST against production:
--     select * from private.cross_program_refs();
-- Zero rows means this migration applies cleanly. Any rows mean the class was
-- already exploited (or a legacy bug wrote a bad reference); §2 then aborts the
-- whole migration rather than deleting anything, and each row must be reviewed
-- with the owning program and re-pointed or removed by hand first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  The edge list, and the pre-flight report
-- ----------------------------------------------------------------------------
-- Every (child, column, parent) where BOTH tables carry a program_id, so the
-- reference is required to stay inside one tenant. competitions.ensemble_id and
-- events.ensemble_id are absent on purpose — 0016 dropped both columns in favor
-- of the competition_ensembles / event_ensembles junctions, which are listed.

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

-- The pre-flight. Read-only: it counts rows whose reference already crosses a
-- tenant boundary and names the edge, so an operator can review each one with
-- the owning program instead of guessing. Zero rows = this migration applies.
-- Service-role only — it is an operator tool, and the counts it returns are
-- deliberately not exposed to a signed-in user.
create or replace function private.cross_program_refs()
returns table (child text, child_column text, parent text, bad_rows bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  e record;
  n bigint;
begin
  for e in select * from private.cross_program_ref_edges() loop
    execute format(
      'select count(*) from %I c join %I p on p.id = c.%I where p.program_id <> c.program_id',
      e.child, e.parent, e.child_column
    ) into n;
    if n > 0 then
      child := e.child; child_column := e.child_column; parent := e.parent; bad_rows := n;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function private.cross_program_refs() from public;
grant execute on function private.cross_program_refs() to service_role;

-- ----------------------------------------------------------------------------
-- §2  Fail closed on pre-existing poison
-- ----------------------------------------------------------------------------
-- The §4 ALTERs would fail anyway — but with a bare 23503 naming one row. This
-- reports every affected edge at once, and states the remedy. It deliberately
-- deletes NOTHING: a poisoned row may carry free text a real person typed, and
-- which program it belongs to is a judgement call, not a migration's decision.

do $$
declare
  report text;
begin
  select string_agg(
           format('%s.%s -> %s: %s row(s)', child, child_column, parent, bad_rows),
           E'\n  ' order by child, child_column)
    into report
    from private.cross_program_refs();

  if report is not null then
    raise exception 'migration 0017 aborted — cross-program references already exist'
      using detail = E'  ' || report,
            hint = 'Review each row with private.cross_program_refs(), decide with the '
                || 'owning program whether to re-point or remove it, then re-run. This '
                || 'migration never deletes user data.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- §3  Parent identity keys
-- ----------------------------------------------------------------------------
-- `unique (id, program_id)` on every table something references. Redundant for
-- uniqueness — id is already the primary key — but a composite FK can only
-- target a unique constraint, so this is the required half of the mechanism.

do $$
declare
  p text;
  -- Not named `conname`: a PL/pgSQL variable sharing a catalog column's name
  -- makes every reference to that column ambiguous (42702), even qualified.
  v_conname text;
begin
  for p in select distinct parent from private.cross_program_ref_edges() order by 1 loop
    v_conname := format('uq_%s_id_program', p);
    if not exists (
      select 1 from pg_constraint
      where conrelid = p::regclass and pg_constraint.conname = v_conname
    ) then
      execute format('alter table %I add constraint %I unique (id, program_id)', p, v_conname);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- §4  Repoint every child reference at the (id, program_id) pair
-- ----------------------------------------------------------------------------
-- The existing constraint is located in the catalog rather than by its
-- generated name, and its ON DELETE action is carried over, so the two
-- cascading junction edges from 0016 keep cascading and nothing else changes
-- behavior. ON DELETE SET NULL / SET DEFAULT would try to null the composite
-- pair including the NOT NULL program_id, so it is refused loudly; no edge uses
-- one today.

do $$
declare
  e        record;
  old_name text;
  del_type "char";
  del_sql  text;
begin
  for e in select * from private.cross_program_ref_edges() loop
    select c.conname, c.confdeltype into old_name, del_type
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = e.child::regclass
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and a.attname = e.child_column;

    if old_name is null then
      raise exception 'no single-column foreign key found on %.% — edge list is stale',
        e.child, e.child_column;
    end if;

    del_sql := case del_type
                 when 'a' then ''
                 when 'r' then ' on delete restrict'
                 when 'c' then ' on delete cascade'
                 else null
               end;
    if del_sql is null then
      raise exception 'foreign key % on %.% uses an on-delete action that cannot null a composite key',
        old_name, e.child, e.child_column;
    end if;

    execute format('alter table %I drop constraint %I', e.child, old_name);
    execute format(
      'alter table %I add constraint %I foreign key (%I, program_id) references %I (id, program_id)%s',
      e.child,
      format('%s_%s_program_fkey', e.child, e.child_column),
      e.child_column,
      e.parent,
      del_sql
    );
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- §5  travel_assignments — stop silently skipping the one-room-one-bus rule
-- ----------------------------------------------------------------------------
-- public.enforce_one_group_per_kind_per_trip (0001) reads the parent group to
-- learn the trip and the kind, but it is SECURITY INVOKER: whenever the group
-- row is not visible under the caller's RLS, the lookup returns NULL, the
-- conflict count matches nothing, and the invariant is skipped entirely with no
-- error. §4 now makes the cross-tenant version of that unrepresentable, but a
-- constraint trigger that quietly does nothing when it cannot see its own parent
-- is the wrong shape regardless. Make it SECURITY DEFINER so the lookup always
-- succeeds, and raise if the parent is genuinely missing rather than passing.
-- Counting across all programs is correct now: the composite FKs guarantee every
-- assignment, group and trip on one trip share a program.

create or replace function public.enforce_one_group_per_kind_per_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_kind    travel_group_kind;
  v_conflict integer;
begin
  select tg.trip_id, tg.kind into v_trip_id, v_kind
  from travel_groups tg
  where tg.id = new.travel_group_id;

  if v_trip_id is null then
    raise exception 'travel group % does not exist', new.travel_group_id
      using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_conflict
  from travel_assignments ta
  join travel_groups g on g.id = ta.travel_group_id
  where g.trip_id = v_trip_id
    and g.kind = v_kind
    and ta.student_id = new.student_id
    and ta.id <> new.id;

  if v_conflict > 0 then
    raise exception
      'student % already assigned to a % group on trip %', new.student_id, v_kind, v_trip_id
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- §6  share_links.resource_id — the one reference no foreign key can express
-- ----------------------------------------------------------------------------
-- resource_id is POLYMORPHIC: a competition id when resource is 'itinerary' or
-- 'packet', a season id when it is 'signup_page' or 'season_calendar'. It
-- carries no foreign key and no check, so minting a link in your own program
-- that points at another program's competition was a direct cross-tenant READ
-- of their student PII through the public /t/<token> surface. lib/tokens.ts now
-- validates at both mint and resolve; this is the same rule stated where no
-- writer can bypass it. Unknown enum values fall through to a raise, so adding a
-- resource kind without teaching this trigger fails closed rather than open.

create or replace function public.enforce_share_link_resource_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resource in ('itinerary', 'packet') then
    if not exists (
      select 1 from competitions c
      where c.id = new.resource_id and c.program_id = new.program_id
    ) then
      raise exception 'share_links.resource_id % is not a competition of program %',
        new.resource_id, new.program_id
        using errcode = 'foreign_key_violation';
    end if;
  elsif new.resource in ('signup_page', 'season_calendar') then
    if not exists (
      select 1 from seasons s
      where s.id = new.resource_id and s.program_id = new.program_id
    ) then
      raise exception 'share_links.resource_id % is not a season of program %',
        new.resource_id, new.program_id
        using errcode = 'foreign_key_violation';
    end if;
  else
    raise exception 'share_links.resource % has no tenancy rule — refusing the write', new.resource
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger trg_share_links_resource_program
  before insert or update of resource, resource_id, program_id on share_links
  for each row execute function public.enforce_share_link_resource_program();
