-- ============================================================================
-- Platform — Ledger integrity: atomic money writes + row-cap-proof totals
-- ----------------------------------------------------------------------------
-- Two confirmed money defects, both fixed here because neither can be fixed
-- honestly in application code alone.
--
-- (1) MONEY COULD DISAPPEAR. Correcting an entry is a void plus a fresh row
--     (Constitution V — the 0002 trigger makes every financial column immutable
--     and forbids un-voiding). The app did those as two separate PostgREST
--     calls with no transaction: if the second one failed — a transient error,
--     or the target budget line deleted between the pre-check and the write —
--     the original was ALREADY voided, permanently, and the amount silently
--     dropped out of every balance with no recovery path in the UI. A void and
--     its replacement are one financial act; they must be one transaction.
--     PostgREST cannot express that, so the write path moves into the database.
--     The same applies to `ledger_audit`: it is the append-only embezzlement
--     control and the ONLY record of what a voided entry contained, so its row
--     is written in the same transaction as the entry it describes — never
--     fire-and-forget afterwards.
--
-- (2) TOTALS SILENTLY UNDER-REPORTED. PostgREST caps a response at `max_rows`
--     (1000 here and on the hosted default). Every treasury total — Balance,
--     In, Out, the uncategorized count, budget-vs-actual, the board snapshot —
--     was computed in JavaScript over a fetched row list, so once a season
--     passed 1000 entries the treasurer would report a WRONG balance to the
--     board with nothing on screen indicating truncation. Aggregates computed
--     in SQL return one row, so no total can ever depend on a row cap again.
--
-- POSTURE. Every function here is SECURITY DEFINER, so each one re-states the
-- guard its RLS policy would have applied, in full and explicitly:
--   * reads  → the treasury read gate (director/admin/treasurer/board_member),
--              plus the time-boxed Octv support read (0004), so the support
--              view keeps working exactly as it does through RLS today.
--   * writes → treasurer only (segregation of duties, §7), and refused on an
--              archived season, mirroring ledger_entries_insert/_update.
--   * tenancy→ every id is required to belong to p_program_id, and every
--              optional tag is required to belong to the entry's SEASON as
--              well (a previous season's budget line, competition or trip
--              booked onto a current-season entry is frozen there forever by
--              the void-only trigger). Nothing here widens what a caller can
--              reach; the composite (id, program_id) foreign keys from 0017
--              remain the engine-level backstop underneath.
--
-- VOID-ONLY IS PRESERVED. No function updates a financial column and none
-- deletes a ledger row. The only UPDATE any of them issues is the void flip the
-- 0002 trigger already permits, and every INSERT is a new row.
--
-- IDEMPOTENT. Drop-then-create with exact signatures, so re-running the file
-- (or re-applying it over an earlier revision of the same function) is safe.
-- No data is read destructively and nothing is deleted.
--
-- DEPLOYMENT ORDER. These functions must exist BEFORE the application code that
-- calls them is deployed: the ledger page and every money write now go through
-- `rpc(...)`. Apply this migration first, then ship the app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  Shared guards
-- ----------------------------------------------------------------------------
-- Read gate: the treasury read matrix, OR an Octv support user inside the
-- director's time-boxed consent window (0004). Mirrors ledger_entries_read +
-- ledger_entries_support_read combined, which is what a SECURITY DEFINER read
-- has to reproduce to avoid quietly revoking support's read-only view.

create or replace function private.ledger_may_read(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_role(
           pid,
           array['director','admin','treasurer','board_member']::program_member_role[]
         )
      or private.is_support_active(pid)
$$;

-- Write gate: treasurer only. Support never writes; no other seat touches money.
create or replace function private.ledger_may_write(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_role(pid, array['treasurer']::program_member_role[])
$$;

revoke execute on function private.ledger_may_read(uuid)  from public, anon;
revoke execute on function private.ledger_may_write(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- §2  Season totals — one row, so no cap can truncate a balance
-- ----------------------------------------------------------------------------
-- Drives the ledger metric strip (Balance / In / Out), the Uncategorized nudge,
-- the reconciliation month list, budget-vs-actual's header, and the board
-- snapshot. One source means those surfaces cannot disagree with each other.
-- Voided rows never count toward any total (Principle V).

drop function if exists public.ledger_season_totals(uuid, uuid);

create function public.ledger_season_totals(
  p_program_id uuid,
  p_season_id  uuid
)
returns table (
  in_cents            bigint,
  out_cents           bigint,
  net_cents           bigint,
  entry_count         bigint,
  uncategorized_count bigint,
  uncategorized_cents bigint,
  months              text[]
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

  return query
  select
    coalesce(sum(e.amount_cents) filter (where e.direction = 'in'), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where e.direction = 'out'), 0)::bigint,
    (coalesce(sum(e.amount_cents) filter (where e.direction = 'in'), 0)
       - coalesce(sum(e.amount_cents) filter (where e.direction = 'out'), 0))::bigint,
    count(*)::bigint,
    count(*) filter (where e.budget_line_id is null)::bigint,
    coalesce(sum(e.amount_cents) filter (where e.budget_line_id is null), 0)::bigint,
    coalesce(
      array_agg(distinct to_char(e.entry_date, 'YYYY-MM')
                order by to_char(e.entry_date, 'YYYY-MM') desc),
      '{}'::text[]
    )
  from ledger_entries e
  where e.program_id = p_program_id
    and e.season_id  = p_season_id
    and e.voided_at is null;
end;
$$;

-- ----------------------------------------------------------------------------
-- §3  Per-budget-line actuals — one row per line, not one per entry
-- ----------------------------------------------------------------------------
-- Budget-vs-actual and the board snapshot's category rollups used to sum a
-- fetched entry list per line, so they truncated with everything else. Grouping
-- in SQL bounds the result by the number of budget lines a program has written,
-- which is the same bound as the line list those pages already render. The
-- uncategorized bucket comes back as the row with a null budget_line_id, so
-- nothing has to be inferred by subtraction.
--
-- The optional competition/trip filters are what the per-event cost report
-- needs; passing neither returns the whole season.

drop function if exists public.ledger_line_actuals(uuid, uuid);
drop function if exists public.ledger_line_actuals(uuid, uuid, uuid, uuid);

create function public.ledger_line_actuals(
  p_program_id     uuid,
  p_season_id      uuid,
  p_competition_id uuid default null,
  p_trip_id        uuid default null
)
returns table (
  budget_line_id uuid,
  in_cents       bigint,
  out_cents      bigint
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

  return query
  select
    e.budget_line_id,
    coalesce(sum(e.amount_cents) filter (where e.direction = 'in'), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where e.direction = 'out'), 0)::bigint
  from ledger_entries e
  where e.program_id = p_program_id
    and e.season_id  = p_season_id
    and e.voided_at is null
    and (p_competition_id is null or e.competition_id = p_competition_id)
    and (p_trip_id        is null or e.trip_id        = p_trip_id)
  group by e.budget_line_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- §4  Running balance for the rows on one page
-- ----------------------------------------------------------------------------
-- The ledger list is paginated now, and a running balance that restarts at zero
-- on page 2 would be a new money bug in place of the one being fixed. This
-- computes the SEASON balance as of each entry — chronological, whole-season,
-- independent of which filter or page the treasurer is looking through — so the
-- column means one thing everywhere. Bounded input (a page of ids), bounded
-- output (one row per id).

drop function if exists public.ledger_running_balance(uuid, uuid, uuid[]);

create function public.ledger_running_balance(
  p_program_id uuid,
  p_season_id  uuid,
  p_entry_ids  uuid[]
)
returns table (
  entry_id      uuid,
  balance_cents bigint
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

  return query
  with live as (
    select e.id,
           e.entry_date,
           e.created_at,
           case when e.direction = 'in' then e.amount_cents else -e.amount_cents end as signed
    from ledger_entries e
    where e.program_id = p_program_id
      and e.season_id  = p_season_id
      and e.voided_at is null
  ),
  running as (
    select l.id,
           sum(l.signed) over (
             order by l.entry_date, l.created_at, l.id
             rows between unbounded preceding and current row
           ) as bal
    from live l
  )
  select r.id, r.bal::bigint
  from running r
  where r.id = any(p_entry_ids);
end;
$$;

-- ----------------------------------------------------------------------------
-- §5  Insert an entry and its 'create' audit row — one transaction
-- ----------------------------------------------------------------------------
-- Returns the new entry id. Raises (rolling everything back) on any guard
-- failure, so a caller can never be told "Saved." for a write that did not
-- happen, and an entry can never exist without its audit row.

drop function if exists public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
);

create function public.add_ledger_entry(
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
  p_receipt_path   text    default null
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
    raise exception 'an entry needs an amount above zero' using errcode = 'P0002';
  end if;

  -- Season: ours, and not archived (mirrors ledger_entries_insert).
  if not exists (
    select 1 from seasons s
    where s.id = p_season_id and s.program_id = p_program_id and s.archived_at is null
  ) then
    raise exception 'that season is not this program''s, or is archived'
      using errcode = 'P0002';
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
      using errcode = 'P0002';
  end if;

  if p_competition_id is not null and not exists (
    select 1 from competitions c
    where c.id = p_competition_id
      and c.program_id = p_program_id
      and c.season_id  = p_season_id
  ) then
    raise exception 'that competition is not in this season' using errcode = 'P0002';
  end if;

  if p_trip_id is not null and not exists (
    select 1 from trips t
    where t.id = p_trip_id
      and t.program_id = p_program_id
      and t.season_id  = p_season_id
  ) then
    raise exception 'that trip is not in this season' using errcode = 'P0002';
  end if;

  insert into ledger_entries (
    program_id, season_id, entry_date, direction, amount_cents,
    budget_line_id, competition_id, trip_id, memo, counterparty,
    receipt_path, entered_by
  ) values (
    p_program_id, p_season_id, coalesce(p_entry_date, current_date), p_direction,
    p_amount_cents, p_budget_line_id, p_competition_id, p_trip_id, p_memo,
    p_counterparty, p_receipt_path, auth.uid()
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
      'memo',           p_memo,
      'counterparty',   p_counterparty,
      'receipt_path',   p_receipt_path
    )
  );

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- §6  Void an entry and its 'void' audit row — one transaction
-- ----------------------------------------------------------------------------
-- Returns true when this call voided the row, false when there was nothing live
-- to void (already voided, or not this program's). False is the friendly case
-- the UI messages; it writes nothing, so no audit row is ever created for a
-- void that did not happen.

drop function if exists public.void_ledger_entry(uuid, uuid, text);

create function public.void_ledger_entry(
  p_entry_id   uuid,
  p_program_id uuid,
  p_reason     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  if not private.ledger_may_write(p_program_id) then
    raise exception 'only the treasurer voids an entry' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a void needs a reason' using errcode = 'P0002';
  end if;

  select e.season_id into v_season
  from ledger_entries e
  where e.id = p_entry_id
    and e.program_id = p_program_id
    and e.voided_at is null
  for update;

  if v_season is null then
    return false;                       -- nothing live to void; write nothing
  end if;
  if private.season_archived(v_season) then
    raise exception 'that season is archived' using errcode = 'P0002';
  end if;

  update ledger_entries
     set voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = p_reason
   where id = p_entry_id;

  insert into ledger_audit (program_id, entry_id, action, actor, diff)
  values (
    p_program_id, p_entry_id, 'void', auth.uid(),
    jsonb_build_object('void_reason', p_reason)
  );

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- §7  Put an uncategorized entry on a budget line — one transaction
-- ----------------------------------------------------------------------------
-- The defect this whole file exists for. Void + re-enter + BOTH audit rows,
-- atomically: either the amount moves onto the line or nothing happened at all.
-- Returns the new entry's id, or null when there was no live uncategorized
-- entry to file (which writes nothing).

drop function if exists public.categorize_ledger_entry(uuid, uuid, uuid);

create function public.categorize_ledger_entry(
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
    raise exception 'pick a budget line' using errcode = 'P0002';
  end if;

  -- Lock the original so a concurrent void or a double submit cannot produce
  -- two replacements for one entry.
  select * into o
  from ledger_entries e
  where e.id = p_entry_id
    and e.program_id = p_program_id
  for update;

  if o.id is null or o.voided_at is not null or o.budget_line_id is not null then
    return null;                        -- nothing to file; write nothing
  end if;
  if private.season_archived(o.season_id) then
    raise exception 'that season is archived' using errcode = 'P0002';
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
      using errcode = 'P0002';
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
    budget_line_id, competition_id, trip_id, memo, counterparty,
    receipt_path, entered_by
  ) values (
    p_program_id, o.season_id, o.entry_date, o.direction, o.amount_cents,
    p_budget_line_id, o.competition_id, o.trip_id, o.memo, o.counterparty,
    o.receipt_path, auth.uid()
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
-- §8  Exposure
-- ----------------------------------------------------------------------------
-- 0007 grants routines broadly (and sets default privileges that would grant
-- these to `anon` on creation). A SECURITY DEFINER function reachable at
-- /rest/v1/rpc/<name> by `anon` is exactly what 0018 cleaned up, so revoke it
-- again here. The in-function guards above remain the real control — the grant
-- is defense in depth, not the boundary.

revoke execute on function public.ledger_season_totals(uuid, uuid)   from public, anon;
revoke execute on function public.ledger_line_actuals(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.ledger_running_balance(uuid, uuid, uuid[]) from public, anon;
revoke execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
) from public, anon;
revoke execute on function public.void_ledger_entry(uuid, uuid, text) from public, anon;
revoke execute on function public.categorize_ledger_entry(uuid, uuid, uuid) from public, anon;

grant execute on function public.ledger_season_totals(uuid, uuid)   to authenticated;
grant execute on function public.ledger_line_actuals(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.ledger_running_balance(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
) to authenticated;
grant execute on function public.void_ledger_entry(uuid, uuid, text) to authenticated;
grant execute on function public.categorize_ledger_entry(uuid, uuid, uuid) to authenticated;
