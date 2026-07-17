-- ============================================================================
-- Octv Platform — Foundation Migration (T002)
-- ----------------------------------------------------------------------------
-- Complete P1 schema: enums, tables, constraints, indexes, triggers.
--
-- Conventions (data-model.md):
--   * id uuid primary key default gen_random_uuid()
--   * every domain table carries denormalized program_id + idx_<table>_program
--   * money is bigint cents; times are timestamptz (UTC)
--   * enums named <table>_<column>
--   * updated_at trigger-maintained on tables with edit UIs
--
-- Constitution (Principle III): minimal directory-tier PII only. NO sensitive-
-- PII columns anywhere — no DOB, address, medical, allergy, dietary,
-- emergency-contact, or photo fields. Tokens store sha256 hash only, never a
-- raw token column.
--
-- Tables are ordered so every foreign-key target is created before its
-- referrers (Postgres requires the referenced table to already exist).
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ============================================================================
-- Shared trigger function: updated_at maintenance
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- ENUMS  (named <table>_<column>)
-- ============================================================================

-- §2 Tenancy
create type program_tier               as enum ('prep', 'varsity', 'program');
create type program_member_role        as enum ('director', 'admin', 'treasurer', 'costume_manager', 'board_member');
create type program_member_status      as enum ('invited', 'active', 'removed');

-- §3 Roster
create type student_status             as enum ('active', 'inactive', 'graduated');
create type guardian_email_status      as enum ('ok', 'bounced', 'unsubscribed');
create type ensemble_member_role       as enum ('performer', 'band', 'crew', 'manager');

-- §4 Costumes
create type costume_piece_kind         as enum ('dress', 'vest', 'pants', 'shoes', 'accessory', 'prop', 'set_piece');
create type costume_piece_condition    as enum ('new', 'good', 'fair', 'retire');
create type costume_assignment_alteration_status as enum ('none', 'needed', 'in_progress', 'done');

-- §5 Competitions / itineraries / documents / attendance
create type competition_status         as enum ('planned', 'confirmed', 'done');
create type attendance_status          as enum ('expected', 'absent', 'partial');
create type document_kind              as enum ('host_packet', 'other');
create type packet_parse_status        as enum ('queued', 'running', 'review', 'accepted', 'failed');
create type itinerary_status           as enum ('draft', 'published');
create type itinerary_source           as enum ('manual', 'parsed');
create type itinerary_item_kind        as enum ('depart', 'arrive', 'homeroom', 'warmup', 'perform', 'meal', 'awards', 'load', 'other');
create type absence_request_status     as enum ('pending', 'confirmed', 'dismissed');

-- §5a Events
create type event_kind                 as enum ('rehearsal', 'fitting', 'fundraiser', 'banquet', 'other');

-- §6 Travel
create type travel_group_kind          as enum ('room', 'bus');

-- §7 Treasury
create type budget_status              as enum ('draft', 'active', 'closed');
create type budget_category_direction  as enum ('income', 'expense');
create type ledger_entry_direction     as enum ('in', 'out');
create type ledger_audit_action        as enum ('create', 'update', 'void');

-- §8 Comms
create type shift_signup_status        as enum ('confirmed', 'cancelled');
create type shift_signup_source        as enum ('token_link', 'staff_entered');
create type announcement_status        as enum ('draft', 'sent');
create type digest_status              as enum ('draft', 'approved', 'sent');

-- §8a Tokens
create type token_event_kind           as enum ('guardian', 'share');
create type share_link_resource        as enum ('itinerary', 'packet', 'signup_page');

-- ============================================================================
-- §2  TENANCY, AUTH, ROLES
-- ============================================================================

create table programs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  school_name       text,
  city              text,
  state             text,
  timezone          text not null,                      -- IANA, e.g. 'America/Chicago'
  tier              program_tier not null default 'prep',
  feature_overrides jsonb not null default '{}'::jsonb,
  weekly_note       text,                               -- §8 digest gathering: director notes precede the draft
  created_at        timestamptz not null default now()
);

create table seasons (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  label       text not null,                            -- "2026-27"
  starts_on   date,
  ends_on     date,
  is_active   boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_seasons_program on seasons(program_id);
-- at most one active season per program
create unique index uq_seasons_one_active_per_program
  on seasons(program_id) where is_active;

create table ensembles (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  name       text not null,                             -- "Varsity Mixed", "Prep"
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_ensembles_program on ensembles(program_id);

-- profiles: id = auth.users.id. Not program-scoped (no program_id); read via
-- shared program membership. Carries no sensitive PII.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  avatar_url text,
  is_support boolean not null default false,            -- §10 Octv staff support view
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table program_members (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id),
  user_id       uuid references auth.users(id),
  role          program_member_role not null,
  status        program_member_status not null default 'invited',
  invited_email text,
  created_at    timestamptz not null default now()
);
create index idx_program_members_program on program_members(program_id);
create index idx_program_members_user on program_members(user_id);
create unique index uq_program_members_user_program
  on program_members(program_id, user_id) where user_id is not null;

-- ============================================================================
-- §3  ROSTER
-- ============================================================================

create table students (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  first_name text not null,
  last_name  text not null,
  grad_year  integer,                                   -- no DOB — grad_year suffices
  sizes      jsonb not null default '{}'::jsonb,        -- program-defined keys: {top, bottom, dress, shoe, ...}
  status     student_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NO address, DOB, photo, health/medical, allergy or emergency-contact fields —
-- constitutional (Principle III).
create index idx_students_program on students(program_id);

create table guardians (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references programs(id),
  student_id   uuid not null references students(id),
  name         text not null,
  email        text,
  phone        text,
  relationship text,
  email_status guardian_email_status not null default 'ok',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_guardians_program on guardians(program_id);
create index idx_guardians_student on guardians(student_id);

create table ensemble_members (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  season_id   uuid not null references seasons(id),
  ensemble_id uuid not null references ensembles(id),
  student_id  uuid not null references students(id),
  role        ensemble_member_role not null default 'performer',
  voice_part  text,
  created_at  timestamptz not null default now(),
  unique (season_id, ensemble_id, student_id)
);
create index idx_ensemble_members_program on ensemble_members(program_id);

-- ============================================================================
-- §5  COMPETITIONS, ITINERARIES, DOCUMENTS, ATTENDANCE
-- ----------------------------------------------------------------------------
-- Defined before costumes and travel because costume_checkouts, attendance,
-- documents, itineraries, trips, and ledger_entries all reference competitions.
-- ============================================================================

create table competitions (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  season_id      uuid not null references seasons(id),
  ensemble_id    uuid references ensembles(id),
  name           text not null,
  host_school    text,
  venue_address  text,
  date           date,
  showchoir_com_url text,
  status         competition_status not null default 'planned',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_competitions_program on competitions(program_id);

create table competition_results (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  placement      text,                                  -- "2nd Runner-Up", "Grand Champion"
  division       text,
  score          numeric,
  captions       jsonb not null default '{}'::jsonb,    -- {"Best Vocals": true, "Best Choreo": true}
  notes          text,
  created_at     timestamptz not null default now(),
  unique (competition_id)
);
create index idx_competition_results_program on competition_results(program_id);

create table attendance (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  student_id     uuid not null references students(id),
  status         attendance_status not null default 'expected',
  note           text,
  created_at     timestamptz not null default now(),
  unique (competition_id, student_id)
);
create index idx_attendance_program on attendance(program_id);

create table documents (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid references competitions(id),
  kind           document_kind not null default 'other',
  storage_path   text not null,
  uploaded_by    uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index idx_documents_program on documents(program_id);

create table packet_parses (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  document_id    uuid not null references documents(id),
  status         packet_parse_status not null default 'queued',
  model          text,
  prompt_version text,
  raw_output     jsonb,
  confidence     jsonb,
  error          text,
  created_at     timestamptz not null default now()
);
create index idx_packet_parses_program on packet_parses(program_id);

create table itineraries (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  status         itinerary_status not null default 'draft',
  published_at   timestamptz,
  source         itinerary_source not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_itineraries_program on itineraries(program_id);

create table itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references itineraries(id),
  program_id   uuid not null references programs(id),
  starts_at    timestamptz,
  ends_at      timestamptz,
  kind         itinerary_item_kind not null default 'other',
  title        text,
  location     text,
  details      text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_itinerary_items_program on itinerary_items(program_id);
create index idx_itinerary_items_itinerary on itinerary_items(itinerary_id);

-- Parent-submitted absence requests → staff review queue (§5).
create table absence_requests (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  student_id     uuid not null references students(id),
  guardian_id    uuid references guardians(id),
  note           text,
  status         absence_request_status not null default 'pending',
  created_at     timestamptz not null default now(),
  resolved_by    uuid references profiles(id),
  resolved_at    timestamptz
);
create index idx_absence_requests_program on absence_requests(program_id);

-- ============================================================================
-- §5a EVENTS
-- ============================================================================

create table events (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  season_id   uuid not null references seasons(id),
  ensemble_id uuid references ensembles(id),            -- null = whole program
  title       text not null,
  starts_at   timestamptz,
  ends_at     timestamptz,
  location    text,
  note        text,
  kind        event_kind not null default 'other',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_events_program on events(program_id);

-- ============================================================================
-- §4  COSTUMES
-- ----------------------------------------------------------------------------
-- costume_checkouts references competitions (defined above).
-- ============================================================================

create table costume_sets (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  season_id   uuid not null references seasons(id),
  ensemble_id uuid references ensembles(id),
  name        text not null,                            -- "Opener", "Ballad"
  sort_order  integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_costume_sets_program on costume_sets(program_id);

create table costume_pieces (
  id                 uuid primary key default gen_random_uuid(),
  program_id         uuid not null references programs(id),
  set_id             uuid references costume_sets(id),  -- current-season grouping; pieces persist across seasons
  kind               costume_piece_kind not null,
  label              text not null,                     -- "Dress #14", "Riser 3"
  size_label         text,
  color              text,
  condition          costume_piece_condition not null default 'good',
  storage_location   text,
  acquired_season_id uuid references seasons(id),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_costume_pieces_program on costume_pieces(program_id);

create table costume_assignments (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references programs(id),
  season_id         uuid not null references seasons(id),
  piece_id          uuid not null references costume_pieces(id),
  student_id        uuid not null references students(id),
  alteration_status costume_assignment_alteration_status not null default 'none',
  alteration_notes  text,
  fitted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (season_id, piece_id)                          -- one piece, one student per season
);
create index idx_costume_assignments_program on costume_assignments(program_id);

create table costume_checkouts (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  competition_id uuid not null references competitions(id),
  assignment_id  uuid references costume_assignments(id),
  piece_id       uuid references costume_pieces(id),    -- direct for props/sets
  checked_out_at timestamptz,
  checked_out_by uuid references profiles(id),
  checked_in_at  timestamptz,
  checked_in_by  uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (assignment_id is not null or piece_id is not null)
);
create index idx_costume_checkouts_program on costume_checkouts(program_id);

-- ============================================================================
-- §6  TRAVEL
-- ============================================================================

create table trips (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  season_id      uuid not null references seasons(id),
  competition_id uuid references competitions(id),
  name           text not null,
  starts_on      date,
  ends_on        date,
  is_overnight   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_trips_program on trips(program_id);

create table travel_groups (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  trip_id    uuid not null references trips(id),
  kind       travel_group_kind not null,               -- room | bus
  label      text not null,                             -- "Room 214", "Bus 1"
  capacity   integer,
  notes      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_travel_groups_program on travel_groups(program_id);
create index idx_travel_groups_trip on travel_groups(trip_id);

create table travel_assignments (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id),
  travel_group_id uuid not null references travel_groups(id),
  student_id      uuid not null references students(id),
  created_at      timestamptz not null default now(),
  unique (travel_group_id, student_id)
);
create index idx_travel_assignments_program on travel_assignments(program_id);

create table travel_chaperones (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id),
  travel_group_id uuid not null references travel_groups(id),
  guardian_id     uuid references guardians(id),
  name_override   text,
  created_at      timestamptz not null default now()
);
create index idx_travel_chaperones_program on travel_chaperones(program_id);

-- ============================================================================
-- §7  TREASURY
-- ============================================================================

create table budgets (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  season_id  uuid not null references seasons(id),
  name       text not null,
  status     budget_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_budgets_program on budgets(program_id);
-- unique active budget per season
create unique index uq_budgets_one_active_per_season
  on budgets(season_id) where status = 'active';

create table budget_categories (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  budget_id  uuid not null references budgets(id),
  name       text not null,
  direction  budget_category_direction not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_budget_categories_program on budget_categories(program_id);

create table budget_lines (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id),
  category_id   uuid not null references budget_categories(id),
  name          text not null,
  planned_cents bigint not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_budget_lines_program on budget_lines(program_id);

create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  season_id      uuid not null references seasons(id),
  entry_date     date not null default current_date,
  direction      ledger_entry_direction not null,
  amount_cents   bigint not null check (amount_cents > 0),
  budget_line_id uuid references budget_lines(id),
  competition_id uuid references competitions(id),
  trip_id        uuid references trips(id),
  memo           text,
  counterparty   text,                                  -- payee or source
  receipt_path   text,
  entered_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,                           -- null = live row
  voided_by      uuid references profiles(id),
  void_reason    text
);
create index idx_ledger_entries_program on ledger_entries(program_id);

-- Append-only audit trail; never updated or deleted (§5, Principle V).
create table ledger_audit (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  entry_id   uuid not null references ledger_entries(id),
  action     ledger_audit_action not null,
  actor      uuid references profiles(id),
  diff       jsonb,
  at         timestamptz not null default now()
);
create index idx_ledger_audit_program on ledger_audit(program_id);

-- ============================================================================
-- §8  COMMS
-- ============================================================================

create table shifts (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  season_id      uuid not null references seasons(id),
  competition_id uuid references competitions(id),
  trip_id        uuid references trips(id),
  event_id       uuid references events(id),
  title          text not null,
  starts_at      timestamptz,
  ends_at        timestamptz,
  needed_count   integer not null default 1,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_shifts_program on shifts(program_id);

create table shift_signups (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  shift_id   uuid not null references shifts(id),
  guardian_id uuid references guardians(id),
  name       text,
  email      text,
  status     shift_signup_status not null default 'confirmed',
  source     shift_signup_source not null default 'token_link',
  created_at timestamptz not null default now()
);
create index idx_shift_signups_program on shift_signups(program_id);
-- one signup per guardian per shift (only when guardian_id present)
create unique index uq_shift_signups_shift_guardian
  on shift_signups(shift_id, guardian_id) where guardian_id is not null;

create table announcements (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  season_id   uuid not null references seasons(id),
  ensemble_id uuid references ensembles(id),            -- null = everyone
  subject     text,
  body_md     text,
  status      announcement_status not null default 'draft',
  created_by  uuid references profiles(id),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_announcements_program on announcements(program_id);

create table announcement_sends (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id),
  announcement_id uuid not null references announcements(id),
  email           text,
  resend_id       text,
  status          text,
  created_at      timestamptz not null default now()
);
create index idx_announcement_sends_program on announcement_sends(program_id);

create table digests (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id),
  week_of        date,
  status         digest_status not null default 'draft',
  subject        text,
  body_md        text,
  model          text,
  prompt_version text,
  approved_by    uuid references profiles(id),
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_digests_program on digests(program_id);

create table digest_sends (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  digest_id  uuid not null references digests(id),
  email      text,
  resend_id  text,
  status     text,
  created_at timestamptz not null default now()
);
create index idx_digest_sends_program on digest_sends(program_id);

-- ============================================================================
-- §8a TOKENS  (store sha256 hash only — never a raw token column)
-- ============================================================================

create table guardian_tokens (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  guardian_id uuid not null references guardians(id),
  token_hash  text not null,                            -- sha256 hex of ≥128-bit random token
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index idx_guardian_tokens_program on guardian_tokens(program_id);
create unique index uq_guardian_tokens_token_hash on guardian_tokens(token_hash);

create table share_links (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs(id),
  resource    share_link_resource not null,
  resource_id uuid not null,
  token_hash  text not null,                            -- sha256 hex of ≥128-bit random token
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_share_links_program on share_links(program_id);
create unique index uq_share_links_token_hash on share_links(token_hash);

create table token_events (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  token_kind token_event_kind not null,                 -- 'guardian' | 'share'
  token_id   uuid not null,                             -- guardian_tokens.id or share_links.id
  action     text not null,
  ip         inet,
  at         timestamptz not null default now()
);
create index idx_token_events_program on token_events(program_id);

-- ============================================================================
-- ONE-ROOM-ONE-BUS-PER-TRIP constraint trigger
-- ----------------------------------------------------------------------------
-- A student may belong to at most one 'room' group and at most one 'bus' group
-- per trip. The 'kind' lives on the parent travel_groups row, so a plain unique
-- index cannot express it — enforced here on insert/update of travel_assignments.
-- ============================================================================

create or replace function public.enforce_one_group_per_kind_per_trip()
returns trigger
language plpgsql
as $$
declare
  v_trip_id uuid;
  v_kind    travel_group_kind;
  v_conflict integer;
begin
  select tg.trip_id, tg.kind into v_trip_id, v_kind
  from travel_groups tg
  where tg.id = new.travel_group_id;

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

create constraint trigger trg_one_group_per_kind_per_trip
  after insert or update on travel_assignments
  deferrable initially immediate
  for each row execute function public.enforce_one_group_per_kind_per_trip();

-- ============================================================================
-- updated_at triggers
-- ----------------------------------------------------------------------------
-- On tables data-model.md lists as having edit UIs: students, guardians,
-- costume_* , itineraries, itinerary_items, budgets, budget_lines, shifts,
-- events, competitions, trips, travel_groups.  (profiles also edits its row.)
-- ============================================================================

create trigger trg_profiles_updated_at            before update on profiles            for each row execute function public.set_updated_at();
create trigger trg_students_updated_at            before update on students            for each row execute function public.set_updated_at();
create trigger trg_guardians_updated_at           before update on guardians           for each row execute function public.set_updated_at();
create trigger trg_costume_sets_updated_at        before update on costume_sets        for each row execute function public.set_updated_at();
create trigger trg_costume_pieces_updated_at      before update on costume_pieces      for each row execute function public.set_updated_at();
create trigger trg_costume_assignments_updated_at before update on costume_assignments for each row execute function public.set_updated_at();
create trigger trg_costume_checkouts_updated_at   before update on costume_checkouts   for each row execute function public.set_updated_at();
create trigger trg_itineraries_updated_at         before update on itineraries         for each row execute function public.set_updated_at();
create trigger trg_itinerary_items_updated_at     before update on itinerary_items     for each row execute function public.set_updated_at();
create trigger trg_budgets_updated_at             before update on budgets             for each row execute function public.set_updated_at();
create trigger trg_budget_lines_updated_at        before update on budget_lines        for each row execute function public.set_updated_at();
create trigger trg_shifts_updated_at              before update on shifts              for each row execute function public.set_updated_at();
create trigger trg_events_updated_at              before update on events              for each row execute function public.set_updated_at();
create trigger trg_competitions_updated_at        before update on competitions        for each row execute function public.set_updated_at();
create trigger trg_trips_updated_at               before update on trips               for each row execute function public.set_updated_at();
create trigger trg_travel_groups_updated_at       before update on travel_groups       for each row execute function public.set_updated_at();
