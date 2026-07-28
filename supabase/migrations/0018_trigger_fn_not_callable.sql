-- ============================================================================
-- Platform — trigger functions are not API endpoints
-- ----------------------------------------------------------------------------
-- PostgREST exposes every function in `public` as an RPC, and 0007_grants.sql
-- grants EXECUTE broadly. That is harmless for a SECURITY INVOKER trigger
-- function, but 0017 made two of them SECURITY DEFINER, which the Supabase
-- security advisor correctly flags: a definer function reachable at
-- /rest/v1/rpc/<name> by `anon`.
--
-- Calling a trigger function directly always fails ("trigger functions can only
-- be called as triggers", errcode 0A000) because it has no trigger context — so
-- this is a hardening measure, not an open hole being closed. Still, the right
-- posture is that these are internal plumbing with no caller but the trigger
-- system, which invokes them irrespective of EXECUTE grants.
--
-- handle_new_auth_user (0008) carries the same shape and predates 0017; it is
-- included because leaving one flagged function behind just trains the next
-- reader to ignore the advisor.
-- ============================================================================

revoke execute on function public.enforce_one_group_per_kind_per_trip() from public, anon, authenticated;
revoke execute on function public.enforce_share_link_resource_program()  from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user()                 from public, anon, authenticated;
