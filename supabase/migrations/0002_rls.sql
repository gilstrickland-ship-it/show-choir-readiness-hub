-- ============================================================================
-- Octv Platform — Row-Level Security Migration (T003)
-- ----------------------------------------------------------------------------
-- Ships WITH the schema (Constitution I): every table gets RLS enabled and
-- membership-gated read policies; writes follow the §2 role matrix. A cross-
-- program leak is the existential bug — RLS is coarse (program membership),
-- fine-grained rules are re-checked in server actions (defense in depth).
--
-- Policies are attached `to authenticated` so anonymous visitors never match.
-- Token-surface tables (shift_signups, absence_requests, guardian_tokens,
-- share_links, token_events) have NO anon policies — parent actions run in a
-- service-role context that bypasses RLS; the capability allow-list in
-- lib/tokens.ts is the boundary there (Constitution II).
-- ============================================================================

-- ============================================================================
-- Helper schema + functions (SECURITY DEFINER, STABLE)
-- ============================================================================

create schema if not exists private;
grant usage on schema private to authenticated, anon, service_role;

-- Program ids the current user is an ACTIVE member of. One-hop RLS anchor.
create or replace function private.member_program_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select program_id
  from program_members
  where user_id = auth.uid()
    and status = 'active'
$$;

-- Does the current user hold one of `roles` in program `pid` (active)?
create or replace function private.has_role(pid uuid, roles program_member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from program_members
    where user_id = auth.uid()
      and program_id = pid
      and status = 'active'
      and role = any(roles)
  )
$$;

-- Archived-season checks. Writes to season-scoped data are rejected when the
-- owning season has archived_at set (Constitution X, invariant §9.4). Tables
-- scoped via competition / itinerary / trip / budget join through.

create or replace function private.season_archived(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from seasons s where s.id = sid and s.archived_at is not null)
$$;

create or replace function private.competition_archived(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from competitions c join seasons s on s.id = c.season_id
    where c.id = cid and s.archived_at is not null
  )
$$;

create or replace function private.itinerary_archived(iid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from itineraries i
    join competitions c on c.id = i.competition_id
    join seasons s on s.id = c.season_id
    where i.id = iid and s.archived_at is not null
  )
$$;

create or replace function private.trip_archived(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trips t join seasons s on s.id = t.season_id
    where t.id = tid and s.archived_at is not null
  )
$$;

create or replace function private.travel_group_archived(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from travel_groups g
    join trips t on t.id = g.trip_id
    join seasons s on s.id = t.season_id
    where g.id = gid and s.archived_at is not null
  )
$$;

create or replace function private.budget_archived(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from budgets b join seasons s on s.id = b.season_id
    where b.id = bid and s.archived_at is not null
  )
$$;

create or replace function private.budget_category_archived(catid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from budget_categories bc
    join budgets b on b.id = bc.budget_id
    join seasons s on s.id = b.season_id
    where bc.id = catid and s.archived_at is not null
  )
$$;

-- ============================================================================
-- Ledger void-only enforcement (T003 ledger bullet)
-- ----------------------------------------------------------------------------
-- Corrections are void + re-enter (Constitution V). Treasurer may UPDATE a
-- ledger entry ONLY to void it — every financial/content field is immutable
-- on update, and a voided entry can never be un-voided. App layer also checks.
-- ============================================================================

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

create trigger trg_ledger_void_only
  before update on ledger_entries
  for each row execute function public.enforce_ledger_void_only();

-- ============================================================================
-- Enable RLS on every table
-- ============================================================================

alter table programs             enable row level security;
alter table seasons              enable row level security;
alter table ensembles            enable row level security;
alter table profiles             enable row level security;
alter table program_members      enable row level security;
alter table students             enable row level security;
alter table guardians            enable row level security;
alter table ensemble_members     enable row level security;
alter table competitions         enable row level security;
alter table competition_results  enable row level security;
alter table attendance           enable row level security;
alter table documents            enable row level security;
alter table packet_parses        enable row level security;
alter table itineraries          enable row level security;
alter table itinerary_items      enable row level security;
alter table absence_requests     enable row level security;
alter table events               enable row level security;
alter table costume_sets         enable row level security;
alter table costume_pieces       enable row level security;
alter table costume_assignments  enable row level security;
alter table costume_checkouts    enable row level security;
alter table trips                enable row level security;
alter table travel_groups        enable row level security;
alter table travel_assignments   enable row level security;
alter table travel_chaperones    enable row level security;
alter table budgets              enable row level security;
alter table budget_categories    enable row level security;
alter table budget_lines         enable row level security;
alter table ledger_entries       enable row level security;
alter table ledger_audit         enable row level security;
alter table shifts               enable row level security;
alter table shift_signups        enable row level security;
alter table announcements        enable row level security;
alter table announcement_sends   enable row level security;
alter table digests              enable row level security;
alter table digest_sends         enable row level security;
alter table guardian_tokens      enable row level security;
alter table share_links          enable row level security;
alter table token_events         enable row level security;

-- ============================================================================
-- §2  Tenancy
-- ============================================================================

-- programs: members read; director/admin manage settings.
create policy programs_read on programs for select to authenticated
  using ( id in (select private.member_program_ids()) );
create policy programs_write on programs for all to authenticated
  using ( private.has_role(id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(id, array['director','admin']::program_member_role[]) );

-- seasons: members read; director/admin manage (archive/unarchive lives here,
-- so NO archived block on the seasons row itself).
create policy seasons_read on seasons for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy seasons_write on seasons for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- ensembles
create policy ensembles_read on ensembles for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy ensembles_write on ensembles for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- profiles: own row + program peers readable; user updates own row only.
create policy profiles_read on profiles for select to authenticated
  using (
    id = auth.uid()
    or id in (
      select pm.user_id from program_members pm
      where pm.status = 'active'
        and pm.program_id in (select private.member_program_ids())
    )
  );
create policy profiles_insert on profiles for insert to authenticated
  with check ( id = auth.uid() );
create policy profiles_update on profiles for update to authenticated
  using ( id = auth.uid() )
  with check ( id = auth.uid() );

-- program_members: members read memberships of their programs; director/admin manage.
create policy program_members_read on program_members for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy program_members_write on program_members for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- ============================================================================
-- §3  Roster (program-scoped — no archive block)
-- ============================================================================

create policy students_read on students for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy students_write on students for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

create policy guardians_read on guardians for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy guardians_write on guardians for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- ensemble_members: season-scoped → archive block.
create policy ensemble_members_read on ensemble_members for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy ensemble_members_write on ensemble_members for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

-- ============================================================================
-- §4  Costumes (director/admin/costume_manager write)
-- ============================================================================

-- costume_pieces: PROGRAM inventory — persists across seasons, no archive block.
create policy costume_pieces_read on costume_pieces for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy costume_pieces_write on costume_pieces for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[]) );

create policy costume_sets_read on costume_sets for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy costume_sets_write on costume_sets for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) );

create policy costume_assignments_read on costume_assignments for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy costume_assignments_write on costume_assignments for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) );

create policy costume_checkouts_read on costume_checkouts for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy costume_checkouts_write on costume_checkouts for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.competition_archived(competition_id) );

-- ============================================================================
-- §5  Competitions / itineraries / documents / attendance
-- ============================================================================

create policy competitions_read on competitions for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy competitions_write on competitions for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

create policy competition_results_read on competition_results for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy competition_results_write on competition_results for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) );

-- attendance: director/admin/costume_manager edit (matrix "Attendance edit").
create policy attendance_read on attendance for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy attendance_write on attendance for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[])
          and not private.competition_archived(competition_id) );

create policy documents_read on documents for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy documents_write on documents for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) );

create policy packet_parses_read on packet_parses for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy packet_parses_write on packet_parses for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) );

create policy itineraries_read on itineraries for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy itineraries_write on itineraries for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) );

create policy itinerary_items_read on itinerary_items for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy itinerary_items_write on itinerary_items for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.itinerary_archived(itinerary_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.itinerary_archived(itinerary_id) );

-- absence_requests: token surface. Parents write via service role (no anon
-- policy). Staff read; attendance editors resolve/manage.
create policy absence_requests_read on absence_requests for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy absence_requests_manage on absence_requests for all to authenticated
  using ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin','costume_manager']::program_member_role[]) );

-- ============================================================================
-- §5a Events
-- ============================================================================

create policy events_read on events for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy events_write on events for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

-- ============================================================================
-- §6  Travel
-- ============================================================================

create policy trips_read on trips for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy trips_write on trips for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

create policy travel_groups_read on travel_groups for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy travel_groups_write on travel_groups for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.trip_archived(trip_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.trip_archived(trip_id) );

create policy travel_assignments_read on travel_assignments for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy travel_assignments_write on travel_assignments for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.travel_group_archived(travel_group_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.travel_group_archived(travel_group_id) );

create policy travel_chaperones_read on travel_chaperones for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy travel_chaperones_write on travel_chaperones for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.travel_group_archived(travel_group_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.travel_group_archived(travel_group_id) );

-- ============================================================================
-- §7  Treasury  (segregation of duties, Constitution V)
-- ----------------------------------------------------------------------------
-- Read: director, admin, treasurer, board_member — NOT costume_manager.
-- Write: treasurer ONLY. Director/admin/board are read-only on money.
-- ============================================================================

create policy budgets_read on budgets for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );
create policy budgets_write on budgets for all to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) );

create policy budget_categories_read on budget_categories for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );
create policy budget_categories_write on budget_categories for all to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.budget_archived(budget_id) )
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.budget_archived(budget_id) );

create policy budget_lines_read on budget_lines for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );
create policy budget_lines_write on budget_lines for all to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.budget_category_archived(category_id) )
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.budget_category_archived(category_id) );

-- ledger_entries: treasurer INSERT + void-only UPDATE (trigger enforces
-- voided-only transitions). NO delete policy — entries void, never delete.
create policy ledger_entries_read on ledger_entries for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );
create policy ledger_entries_insert on ledger_entries for insert to authenticated
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) );
create policy ledger_entries_update on ledger_entries for update to authenticated
  using ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[])
          and not private.season_archived(season_id) );

-- ledger_audit: insert-only append log. No update/delete policies.
create policy ledger_audit_read on ledger_audit for select to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','board_member']::program_member_role[]) );
create policy ledger_audit_insert on ledger_audit for insert to authenticated
  with check ( private.has_role(program_id, array['treasurer']::program_member_role[]) );

-- ============================================================================
-- §8  Comms
-- ============================================================================

-- shifts: shift management = director/admin/treasurer/costume_manager.
create policy shifts_read on shifts for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy shifts_write on shifts for all to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin','treasurer','costume_manager']::program_member_role[])
          and not private.season_archived(season_id) );

-- shift_signups: token surface. Parent signups arrive via service role (no anon
-- policy). Staff read; shift managers add/adjust staff-entered signups.
create policy shift_signups_read on shift_signups for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy shift_signups_manage on shift_signups for all to authenticated
  using ( private.has_role(program_id, array['director','admin','treasurer','costume_manager']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin','treasurer','costume_manager']::program_member_role[]) );

-- announcements + sends: compose/approve/send = director/admin.
create policy announcements_read on announcements for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy announcements_write on announcements for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

create policy announcement_sends_read on announcement_sends for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy announcement_sends_write on announcement_sends for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- digests + sends: approve/send = director/admin. (No season_id → no archive block.)
create policy digests_read on digests for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy digests_write on digests for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

create policy digest_sends_read on digest_sends for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy digest_sends_write on digest_sends for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- ============================================================================
-- §8a Tokens (token surface — NO anon policies; service role bypasses RLS)
-- ============================================================================

-- guardian_tokens / share_links: staff read via membership; director/admin
-- mint & revoke (Settings → guardian row → "resend links").
create policy guardian_tokens_read on guardian_tokens for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy guardian_tokens_write on guardian_tokens for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

create policy share_links_read on share_links for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy share_links_write on share_links for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[]) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[]) );

-- token_events: security audit log. Staff read via membership; writes come from
-- the service-role token context only (no staff write policy).
create policy token_events_read on token_events for select to authenticated
  using ( program_id in (select private.member_program_ids()) );

-- ============================================================================
-- Storage buckets + policies
-- ----------------------------------------------------------------------------
-- Buckets 'documents' (host packets) and 'receipts'. Objects are namespaced by
-- program_id as the first path segment: `<program_id>/...`. Policies mirror
-- membership (coarse; role refinement in server actions per Constitution I).
--
-- Guarded so the migration also applies on plain Postgres (CI / local) where
-- the Supabase `storage` schema and helpers are absent.
-- ============================================================================

do $storage$
begin
  if to_regnamespace('storage') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'storage schema/helpers absent — skipping bucket + policy setup';
    return;
  end if;

  insert into storage.buckets (id, name, public)
    values ('documents', 'documents', false)
    on conflict (id) do nothing;
  insert into storage.buckets (id, name, public)
    values ('receipts', 'receipts', false)
    on conflict (id) do nothing;

  execute 'alter table storage.objects enable row level security';

  -- Read: active members of the program that owns the folder.
  execute $p$ drop policy if exists octv_storage_read on storage.objects $p$;
  execute $p$
    create policy octv_storage_read on storage.objects for select to authenticated
    using (
      bucket_id in ('documents','receipts')
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
  $p$;

  -- Insert
  execute $p$ drop policy if exists octv_storage_insert on storage.objects $p$;
  execute $p$
    create policy octv_storage_insert on storage.objects for insert to authenticated
    with check (
      bucket_id in ('documents','receipts')
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
  $p$;

  -- Update
  execute $p$ drop policy if exists octv_storage_update on storage.objects $p$;
  execute $p$
    create policy octv_storage_update on storage.objects for update to authenticated
    using (
      bucket_id in ('documents','receipts')
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
    with check (
      bucket_id in ('documents','receipts')
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
  $p$;

  -- Delete
  execute $p$ drop policy if exists octv_storage_delete on storage.objects $p$;
  execute $p$
    create policy octv_storage_delete on storage.objects for delete to authenticated
    using (
      bucket_id in ('documents','receipts')
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
  $p$;
end
$storage$;
