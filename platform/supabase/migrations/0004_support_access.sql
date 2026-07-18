-- ============================================================================
-- Octv Platform — Support access (T030, §10)
-- ----------------------------------------------------------------------------
-- Octv staff (profiles.is_support = true) get a READ-ONLY view of a program,
-- but ONLY while the director has granted consent: programs.support_access_until
-- is a timestamp in the future. This is a deliberate cross-tenant read path,
-- gated by BOTH is_support AND time-boxed consent — never a write path.
--
-- Implementation: one additive, permissive `for select` policy per program-
-- scoped table (Postgres OR-combines permissive SELECT policies), plus the
-- programs row itself. No write policy is ever added for support — RLS blocks
-- every support write, and server actions re-check membership (which support
-- lacks) as defense in depth (Constitution I).
-- ============================================================================

alter table programs
  add column if not exists support_access_until timestamptz;

-- Is the current user an Octv support user WITH active consent on program `pid`?
-- SECURITY DEFINER so it can read profiles.is_support + programs.support_access_until
-- regardless of the caller's own row visibility. STABLE — no side effects.
create or replace function private.is_support_active(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join programs pr on pr.id = pid
    where p.id = auth.uid()
      and p.is_support = true
      and pr.support_access_until is not null
      and pr.support_access_until > now()
  )
$$;

-- programs: support reads the program row itself (keyed on id, not program_id).
create policy programs_support_read on programs for select to authenticated
  using ( private.is_support_active(id) );

-- Every program-scoped table gets an additive read-only support policy. Written
-- as a loop so the set stays in lockstep with the schema and no table is missed.
do $support$
declare
  t text;
  tables text[] := array[
    'seasons','ensembles','program_members','students','guardians',
    'ensemble_members','competitions','competition_results','attendance',
    'documents','packet_parses','itineraries','itinerary_items',
    'absence_requests','events','costume_sets','costume_pieces',
    'costume_assignments','costume_checkouts','trips','travel_groups',
    'travel_assignments','travel_chaperones','budgets','budget_categories',
    'budget_lines','ledger_entries','ledger_audit','shifts','shift_signups',
    'announcements','announcement_sends','digests','digest_sends',
    'guardian_tokens','share_links','token_events'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on %I for select to authenticated using ( private.is_support_active(program_id) )',
      t || '_support_read', t
    );
  end loop;
end
$support$;
