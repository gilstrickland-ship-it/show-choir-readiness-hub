-- ============================================================================
-- Platform — Explicit API role grants
-- ----------------------------------------------------------------------------
-- Depending on which role applies migrations (postgres vs supabase_admin,
-- which varies by CLI/platform version), the standard Supabase default
-- privileges may not attach to our tables, leaving PostgREST's roles without
-- table access ("permission denied"). Grant explicitly and set default
-- privileges going forward. Row-level security remains the gate for anon and
-- authenticated — grants plus RLS is the normal Supabase access model, and the
-- RLS suite proves the policies.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;

grant usage on schema private to anon, authenticated, service_role;
grant execute on all functions in schema private to anon, authenticated, service_role;
