-- ============================================================================
-- Platform — Convergence migration (Phase 9, T031 / T035 / T036)
-- ----------------------------------------------------------------------------
-- Three additive changes, one file (the harness applies every migration in
-- lexical order, so 0005 is exercised by the RLS suite automatically):
--   • T031  competitions.meal_note — a nullable free-text logistics note for the
--           per-competition meal count (vendor, serving time). NON-health only.
--   • T035  support_access_log — a durable, queryable record of support views
--           (who looked at what program, when), readable by the program's own
--           director/admin/board for transparency, written ONLY by the service
--           role (no client INSERT policy → every authenticated write is denied).
--   • T036  export_jobs — minimal async export-job tracking (queued→running→
--           done|failed), plus an `exports` Storage bucket for the built zips.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- T031 · Meal count logistics note (competitions)
-- ---------------------------------------------------------------------------
-- Free-text, NON-health (Constitution III / arch §5): vendor, serving window,
-- allergy-station location as logistics — never a student's medical detail. The
-- meal-count screen and the `meal` PDF label it accordingly. Writes ride the
-- existing competitions_write policy (director/admin, blocked when archived).
alter table competitions
  add column if not exists meal_note text;

-- ---------------------------------------------------------------------------
-- T035 · Support access audit log (arch §10)
-- ---------------------------------------------------------------------------
-- Replaces the console/Sentry-breadcrumb-only trail with a durable row per
-- support view. The breadcrumb stays (lib/support.ts) for live debugging; this
-- table is the queryable record the consenting program can inspect itself.
create table if not exists support_access_log (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id),
  support_user_id uuid not null references profiles(id),
  path            text,
  at              timestamptz not null default now()
);
create index if not exists idx_support_access_log_program on support_access_log(program_id);
create index if not exists idx_support_access_log_at on support_access_log(program_id, at desc);

alter table support_access_log enable row level security;

-- Transparency read: the program's own director/admin/board can see who from
-- support looked, and when. Support itself is NOT granted read here (it is not a
-- member, and 0004's support-read loop deliberately omits this table) — the log
-- exists FOR the program, not for support.
create policy support_access_log_read on support_access_log for select to authenticated
  using (
    private.has_role(
      program_id,
      array['director','admin','board_member']::program_member_role[]
    )
  );

-- NO insert/update/delete policy: every authenticated write is therefore denied
-- by RLS. Rows are written exclusively by the service-role client (lib/support.ts
-- logSupportView), which bypasses RLS. This keeps the audit trail tamper-evident
-- — not even a support user with active consent can forge or erase an entry.

-- ---------------------------------------------------------------------------
-- T036 · Async export jobs (arch §13.2)
-- ---------------------------------------------------------------------------
-- Honest, minimal job tracking — we do NOT overload the documents table. The
-- Inngest `export/all` function inserts a `queued` row, flips it to `running`,
-- uploads the zip to the `exports` bucket, and finishes `done` (storage_path
-- set) or `failed` (error set). Director/admin read their program's jobs on the
-- export settings page; writes are service-role only (no client write policy).
create table if not exists export_jobs (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id),
  status        text not null default 'queued',   -- queued | running | done | failed
  storage_path  text,
  requested_by  uuid references profiles(id),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text
);
create index if not exists idx_export_jobs_program on export_jobs(program_id, created_at desc);

alter table export_jobs enable row level security;

-- Read: director/admin of the program (the export surface is director/admin per
-- SETTINGS_ROLES). No write policy → authenticated writes denied; the Inngest
-- job writes via the service-role client.
create policy export_jobs_read on export_jobs for select to authenticated
  using (
    private.has_role(program_id, array['director','admin']::program_member_role[])
  );

-- ---------------------------------------------------------------------------
-- T036 · `exports` Storage bucket + membership-read policy
-- ---------------------------------------------------------------------------
-- Built zips land at `<program_id>/<job_id>.zip`. Guarded so the migration also
-- applies on plain Postgres (CI / the RLS scratch cluster) where the Supabase
-- `storage` schema is absent — mirrors the 0002 bucket block exactly.
do $exports$
begin
  if to_regnamespace('storage') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'storage schema/helpers absent — skipping exports bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public)
    values ('exports', 'exports', false)
    on conflict (id) do nothing;

  -- Read: active members of the program that owns the folder. (Delivery is via a
  -- service-role signed URL, so this policy is defense-in-depth for any direct
  -- authenticated access.)
  execute $p$ drop policy if exists exports_storage_read on storage.objects $p$;
  execute $p$
    create policy exports_storage_read on storage.objects for select to authenticated
    using (
      bucket_id = 'exports'
      and (storage.foldername(name))[1]::uuid in (select private.member_program_ids())
    )
  $p$;
end
$exports$;
