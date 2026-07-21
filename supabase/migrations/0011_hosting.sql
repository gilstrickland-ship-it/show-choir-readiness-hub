-- ============================================================================
-- Platform — Host-mode module (Wave I / I1)
-- ----------------------------------------------------------------------------
-- The program runs its OWN invitational: the single biggest fundraiser and ops
-- lift. Staff-only surface behind the `hosting` flag (default off). Visiting
-- schools have no accounts (Constitution II) — their surface is email + what the
-- host prints/sends. Zero AI (Constitution IV).
--
-- Three tables, all program-scoped with denormalized program_id for coarse RLS:
--   hosted_events   — one invitational the program hosts (season-scoped).
--   hosted_schools  — a visiting school + ADULT professional director contact
--                     and counts only. NO student data of visiting schools, ever
--                     (Constitution III) — performer_count is an int, not a roster.
--   hosted_slots    — the day-of schedule grid (warm-up / perform / break / …).
--
-- This migration ships schema WITH its RLS policies + archived-season freeze in
-- the same change (Constitution I). The RLS isolation suite enumerates program_id
-- tables at runtime, so these three are swept automatically; seed rows land in
-- tests/rls/seed.ts alongside this migration.
--
-- Free-text fields (venue_notes, arrival_notes, costume_colors, label) carry the
-- standing "do not enter health or medical information" label on their surfaces.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS (named <table>_<column>)
-- ----------------------------------------------------------------------------

create type hosted_event_status as enum ('planning', 'scheduled', 'done');
create type hosted_slot_kind    as enum ('warmup', 'perform', 'break', 'awards', 'meal', 'other');

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

create table hosted_events (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  season_id   uuid not null references seasons(id),
  name        text not null,
  event_date  date,
  venue_notes text,
  status      hosted_event_status not null default 'planning',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_hosted_events_program on hosted_events(program_id);
create index idx_hosted_events_season  on hosted_events(season_id);

create table hosted_schools (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id),
  hosted_event_id uuid not null references hosted_events(id),
  school_name     text not null,
  ensemble_name   text,
  director_name   text,                                 -- adult professional contact only
  director_email  text,                                 -- (Constitution III — never students)
  director_phone  text,
  performer_count integer,                              -- a COUNT, never a roster of visiting students
  division        text,                                 -- "Large Mixed" — host-defined free text
  costume_colors  text,                                 -- homeroom decoration cue (research norm)
  homeroom        text,                                 -- room label, e.g. "Rm 214"
  arrival_notes   text,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_hosted_schools_program on hosted_schools(program_id);
create index idx_hosted_schools_event   on hosted_schools(hosted_event_id);

create table hosted_slots (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references programs(id),
  hosted_event_id  uuid not null references hosted_events(id),
  hosted_school_id uuid references hosted_schools(id),  -- null = break / awards / meal
  kind             hosted_slot_kind not null default 'other',
  label            text,                                -- "Awards — daytime", or auto from school
  starts_at        timestamptz,                         -- UTC, rendered in program tz (Constitution VII)
  duration_minutes integer,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_hosted_slots_program on hosted_slots(program_id);
create index idx_hosted_slots_event   on hosted_slots(hosted_event_id);
create index idx_hosted_slots_school  on hosted_slots(hosted_school_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers (all three carry edit UIs)
-- ----------------------------------------------------------------------------

create trigger trg_hosted_events_updated_at  before update on hosted_events  for each row execute function public.set_updated_at();
create trigger trg_hosted_schools_updated_at before update on hosted_schools for each row execute function public.set_updated_at();
create trigger trg_hosted_slots_updated_at   before update on hosted_slots   for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Archived-season freeze (Constitution X, invariant §9.4)
-- ----------------------------------------------------------------------------
-- hosted_events is season-scoped → writes are rejected once the owning season is
-- archived (mirrors competitions/events). Child tables (hosted_schools,
-- hosted_slots) inherit the freeze via their hosted_event's season, exactly the
-- way itinerary_items freeze through their itinerary and travel_groups through
-- their trip.

create or replace function private.hosted_event_archived(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from hosted_events he
    join seasons s on s.id = he.season_id
    where he.id = eid and s.archived_at is not null
  )
$$;

grant execute on function private.hosted_event_archived(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS — coarse membership read; director/admin write; board read-only;
-- treasurer/costume_manager read via membership but never write.
-- ----------------------------------------------------------------------------

alter table hosted_events  enable row level security;
alter table hosted_schools enable row level security;
alter table hosted_slots   enable row level security;

-- hosted_events: season-scoped → season_archived block on write.
create policy hosted_events_read on hosted_events for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy hosted_events_write on hosted_events for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.season_archived(season_id) );

-- hosted_schools: freeze through the hosted_event's season.
create policy hosted_schools_read on hosted_schools for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy hosted_schools_write on hosted_schools for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.hosted_event_archived(hosted_event_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.hosted_event_archived(hosted_event_id) );

-- hosted_slots: freeze through the hosted_event's season.
create policy hosted_slots_read on hosted_slots for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy hosted_slots_write on hosted_slots for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.hosted_event_archived(hosted_event_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.hosted_event_archived(hosted_event_id) );
