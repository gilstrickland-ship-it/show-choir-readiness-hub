-- ============================================================================
-- Platform — Multi-day hosted invitationals (Wave N)
-- ----------------------------------------------------------------------------
-- Adds a single nullable `end_date` column to hosted_events: the LAST calendar
-- day of an invitational that spans more than one day (Friday prelims + Saturday
-- finals; a prep day + a varsity day). Null = single-day, which is every existing
-- event — the column is nullable and unbackfilled, so nothing changes for events
-- that already exist. When set, surfaces render event_date–end_date as a range
-- (noon-anchored per Constitution VII) and the schedule + day-of PDFs group slots
-- under day subheadings.
--
-- Server actions validate event_date <= end_date before writing (a friendly
-- error, not a raw constraint failure); an end_date equal to event_date is
-- normalized back to null so "spans more than one day" stays a clean predicate.
--
-- Column add only: no RLS policy changes are required. hosted_events already
-- carries its coarse program-scoped policies + archived-season freeze from
-- 0011_hosting.sql, and the RLS isolation suite re-derives hosted_events
-- automatically.
-- ============================================================================

alter table hosted_events
  add column if not exists end_date date;
