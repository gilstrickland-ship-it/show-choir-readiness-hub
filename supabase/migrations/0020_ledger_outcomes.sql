-- ============================================================================
-- Platform — Ledger write outcomes a treasurer can act on
-- ----------------------------------------------------------------------------
-- 0019 moved every money write into the database and made each one atomic. What
-- it did not do is let the caller tell its outcomes apart, and the ledger UI has
-- been reporting failure for work that succeeded ever since.
--
-- (1) DOUBLE SUBMIT SAID THE FILING FAILED. categorize_ledger_entry returned
--     NULL for three unrelated outcomes — the entry is not this program's, the
--     entry is already voided, the entry is already on a line — so the action
--     collapsed all three (plus every real error) into one message: "Nothing
--     changed — the entry is still there, uncategorized." Filing is a void plus
--     a replacement, so a double submit arrives carrying the ORIGINAL id and
--     finds it voided: the treasurer is told their filing did nothing, about a
--     filing that worked. They then go looking for a row that is no longer in
--     the list, or file it a second time.
--
-- (2) VOID SAID THE SAME THING TWICE. void_ledger_entry returned `false` both
--     for "not this program's entry" and for "already voided", which are a
--     tenancy mistake and a no-op respectively and want different sentences.
--
-- (3) EVERY add_ledger_entry REJECTION READ AS "check the amount". Five distinct
--     guards raised the same SQLSTATE, so a competition tagged from the wrong
--     season came back as advice about the amount format.
--
-- The fix is to give each outcome its own SQLSTATE. Application code branches on
-- error.code (which PostgREST passes through verbatim), never on message text,
-- so the sentences stay in the UI where they can be edited without a migration.
--
-- SQLSTATE CLASS. Class `OC` is unused by PostgreSQL and by PostgREST, so these
-- cannot collide with an engine condition the way P0002 (no_data_found) and
-- P0004 (assert_failure) would:
--   OC001  the entry is not this program's (or does not exist)
--   OC002  the entry was already filed onto a budget line
--   OC003  the entry is already voided (by hand, not by a filing)
--   OC010  the amount is missing or not above zero
--   OC011  the season is not this program's, or is archived
--   OC012  the budget line is not on this season's budget
--   OC013  the competition is not in this season
--   OC014  the trip is not in this season
--   OC015  no budget line was named
-- The 42501 role refusals are UNCHANGED — they are the security boundary and
-- keep the standard insufficient_privilege code.
--
-- NOTHING ELSE CHANGES. No signature, no return type, no guard, no write. These
-- are the same three functions with the same tenancy, season and role checks in
-- the same order; only the codes they raise are new. Void-only is preserved:
-- the only UPDATE is still the void flip 0002 permits, every INSERT is a new
-- row, and no function deletes anything.
--
-- IDEMPOTENT. `create or replace` with identical signatures, so re-running the
-- file is safe. The exposure block at the end is restated because a REPLACE
-- keeps an existing ACL but a first-time CREATE picks up 0007's default
-- privileges (which include `anon`) — so the revokes have to be re-asserted for
-- a fresh database to land where an upgraded one does.
--
-- DEPLOYMENT ORDER. Apply this migration BEFORE the application code that reads
-- the new codes. The app degrades safely if it is deployed first (an unknown
-- code falls back to the generic message it shows today), but the messages this
-- change exists for are only correct once the functions are in place.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  add_ledger_entry — one code per rejection
-- ----------------------------------------------------------------------------

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
-- §2  void_ledger_entry — "not yours" and "already voided" are different facts
-- ----------------------------------------------------------------------------
-- Still returns boolean, and still returns true on exactly one thing: this call
-- voided the row. The `false` it used to return for two unrelated no-ops is
-- gone — both raise now, each with its own code, and neither writes anything.

create or replace function public.void_ledger_entry(
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
    raise exception 'a void needs a reason' using errcode = 'OC010';
  end if;

  select e.season_id into v_season
  from ledger_entries e
  where e.id = p_entry_id
    and e.program_id = p_program_id
    and e.voided_at is null
  for update;

  if v_season is null then
    -- Nothing LIVE to void. Which of the two reasons it is decides what the
    -- treasurer is told, and neither writes a row or an audit entry.
    if exists (
      select 1 from ledger_entries e
      where e.id = p_entry_id and e.program_id = p_program_id
    ) then
      raise exception 'that entry is already voided' using errcode = 'OC003';
    end if;
    raise exception 'that entry is not this program''s' using errcode = 'OC001';
  end if;

  if private.season_archived(v_season) then
    raise exception 'that season is archived' using errcode = 'OC011';
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
-- §3  categorize_ledger_entry — a double submit is "already filed", not failure
-- ----------------------------------------------------------------------------
-- Returns the new entry's id, exactly as before, when it files something. The
-- three NULLs are gone. The interesting one is the second submit of the same
-- form: filing voids the original and writes a replacement, so the resubmit
-- arrives with the ORIGINAL id and finds it voided. The replacement's 'create'
-- audit row records what it replaced, which makes "already filed" a fact this
-- function can state rather than a guess — and distinguishes it from an entry a
-- treasurer voided by hand, which really has nothing to file.

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
-- §4  Exposure (restated — see the header for why)
-- ----------------------------------------------------------------------------

revoke execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
) from public, anon;
revoke execute on function public.void_ledger_entry(uuid, uuid, text) from public, anon;
revoke execute on function public.categorize_ledger_entry(uuid, uuid, uuid) from public, anon;

grant execute on function public.add_ledger_entry(
  uuid, uuid, date, ledger_entry_direction, bigint, uuid, uuid, uuid, text, text, text
) to authenticated;
grant execute on function public.void_ledger_entry(uuid, uuid, text) to authenticated;
grant execute on function public.categorize_ledger_entry(uuid, uuid, uuid) to authenticated;
