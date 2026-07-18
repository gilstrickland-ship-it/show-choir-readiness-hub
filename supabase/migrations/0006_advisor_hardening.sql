-- ============================================================================
-- Platform — Advisor hardening (post-deploy)
-- ----------------------------------------------------------------------------
-- Supabase security advisor 0011 (function_search_path_mutable): trigger
-- functions execute with the table owner's rights, so an unpinned search_path
-- is a hijack surface. Pin all three to `public`. The private.* helpers already
-- pin theirs at creation (0002/0004).
-- ============================================================================

alter function public.set_updated_at() set search_path = public;
alter function public.enforce_ledger_void_only() set search_path = public;
alter function public.enforce_one_group_per_kind_per_trip() set search_path = public;
