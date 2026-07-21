-- ============================================================================
-- Platform — First-use guide state (Phase 12, spec 003-first-use-tours §1)
-- ----------------------------------------------------------------------------
-- Adds a single per-person, per-program `guide_state` jsonb to program_members.
-- It carries only presentational preferences for the first-use guide:
--
--   { "journey_dismissed": true,          -- hides the role journey panel
--     "strips": { "<surfaceKey>": true }  -- an intro strip collapsed per surface
--   }
--
-- No completion timestamps are ever stored here: journey step completion is
-- ALWAYS derived from live data at render (idempotent, device-independent, and
-- correct after a re-role). This column holds dismissal/collapse preferences
-- only.
--
-- Writes go through a guarded server action that uses the service-role client
-- with an explicit "the session user owns this membership row" check —
-- program_members has no self-update RLS policy, so the guarded action is the
-- write path (defense in depth, same idiom as the token routes). Reads ride the
-- existing coarse program_members read policy (a member can read their own row).
--
-- Column add only: no RLS policy changes are required. program_members already
-- carries its policies from 0002_rls.sql, and the RLS isolation suite re-derives
-- program_members automatically (it carries a program_id).
-- ============================================================================

alter table program_members
  add column if not exists guide_state jsonb not null default '{}'::jsonb;
