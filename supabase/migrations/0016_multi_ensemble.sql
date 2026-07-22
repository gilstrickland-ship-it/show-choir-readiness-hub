-- ============================================================================
-- Platform — Multi-ensemble competitions & events (Feature 004)
-- ----------------------------------------------------------------------------
-- Programs routinely send more than one ensemble to the same competition and
-- share the same calendar events. Today a competition belongs to exactly one
-- ensemble (competitions.ensemble_id) and an event is either whole-program
-- (events.ensemble_id is null) or a single ensemble. This migration replaces the
-- single-column model with two junction tables so a competition can include one
-- OR MORE ensembles, and an event can target the whole program, one ensemble, or
-- any subset.
--
--   competition_ensembles — the ensembles participating in a competition.
--                           Invariant (server-action enforced): ≥ 1 row per comp.
--   event_ensembles       — the ensembles an event targets. ZERO rows = whole
--                           program (dynamic — ensembles added later are included
--                           automatically), preserving today's `ensemble_id is
--                           null` semantics. ≥ 1 rows = exactly that subset.
--
-- Both carry denormalized program_id for coarse RLS (Constitution I) and reuse
-- the exact program-member policy shape their parents use. Schema ships WITH its
-- RLS policies in the same change; the isolation suite enumerates program_id
-- tables at runtime, so both are swept automatically, and seed rows land in
-- tests/rls/seed.ts alongside this migration.
--
-- Migration order (Constitution VIII — no half-migrated dual-read path):
--   1. create both junction tables + indexes + RLS
--   2. backfill one row per existing single-ensemble competition / event
--   3. DROP competitions.ensemble_id and events.ensemble_id
-- Existing single-ensemble competitions and single/whole-program events migrate
-- with zero behavior change (D2, D7).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Archived-season freeze helper for event_ensembles (events are season-scoped;
-- competitions already have private.competition_archived from 0002).
-- ----------------------------------------------------------------------------

create or replace function private.event_archived(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from events e
    join seasons s on s.id = e.season_id
    where e.id = eid and s.archived_at is not null
  )
$$;

grant execute on function private.event_archived(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

create table competition_ensembles (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),          -- denormalized for RLS (Constitution I)
  competition_id uuid not null references competitions(id) on delete cascade,
  ensemble_id    uuid not null references ensembles(id),
  created_at     timestamptz not null default now(),
  unique (competition_id, ensemble_id)
);
create index idx_competition_ensembles_program     on competition_ensembles(program_id);
create index idx_competition_ensembles_competition on competition_ensembles(competition_id);
create index idx_competition_ensembles_ensemble    on competition_ensembles(ensemble_id);

create table event_ensembles (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),             -- denormalized for RLS
  event_id    uuid not null references events(id) on delete cascade,
  ensemble_id uuid not null references ensembles(id),
  created_at  timestamptz not null default now(),
  unique (event_id, ensemble_id)
);
create index idx_event_ensembles_program  on event_ensembles(program_id);
create index idx_event_ensembles_event    on event_ensembles(event_id);
create index idx_event_ensembles_ensemble on event_ensembles(ensemble_id);

-- ----------------------------------------------------------------------------
-- RLS — coarse membership read; director/admin write (fine role checks stay in
-- server actions per Constitution I). Write freezes through the parent's season:
-- competition_ensembles via competition_archived; event_ensembles via
-- event_archived — the same posture attendance / itinerary junctions use.
-- ----------------------------------------------------------------------------

alter table competition_ensembles enable row level security;
alter table event_ensembles       enable row level security;

create policy competition_ensembles_read on competition_ensembles for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy competition_ensembles_write on competition_ensembles for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.competition_archived(competition_id) );

create policy event_ensembles_read on event_ensembles for select to authenticated
  using ( program_id in (select private.member_program_ids()) );
create policy event_ensembles_write on event_ensembles for all to authenticated
  using ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.event_archived(event_id) )
  with check ( private.has_role(program_id, array['director','admin']::program_member_role[])
          and not private.event_archived(event_id) );

-- ----------------------------------------------------------------------------
-- BACKFILL — one junction row per existing single-ensemble competition / event.
-- Whole-program events (ensemble_id is null) produce NO rows — that IS the
-- whole-program semantic (D2). Idempotent via the unique constraints.
-- ----------------------------------------------------------------------------

insert into competition_ensembles (program_id, competition_id, ensemble_id)
select program_id, id, ensemble_id
from competitions
where ensemble_id is not null
on conflict (competition_id, ensemble_id) do nothing;

insert into event_ensembles (program_id, event_id, ensemble_id)
select program_id, id, ensemble_id
from events
where ensemble_id is not null
on conflict (event_id, ensemble_id) do nothing;

-- ----------------------------------------------------------------------------
-- DROP the old single-ensemble columns — no dual-read path remains
-- (Constitution VIII). Every read migrates to the junction in the same change.
-- ----------------------------------------------------------------------------

alter table competitions drop column ensemble_id;
alter table events        drop column ensemble_id;
