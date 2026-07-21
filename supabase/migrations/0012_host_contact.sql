-- ============================================================================
-- Platform — Host-mode day-of contact (Wave J)
-- ----------------------------------------------------------------------------
-- Adds a single nullable `host_contact` column to hosted_events: the day-of
-- contact line printed on the visiting-director packet ("Your host"), e.g.
-- "Jane Smith · 555-0100". Previously the packet fell back to the platform's
-- brand support email, which is operator infrastructure, not a person a visiting
-- director can call on event day.
--
-- Free text (a name + phone), so it rides the same "do not enter health or
-- medical information" label the event's other free-text fields already carry —
-- no new surface, no health/PII concern (an adult host's own contact line).
--
-- Column add only: no RLS policy changes are required. hosted_events already
-- carries its coarse program-scoped policies from 0011_hosting.sql, and the RLS
-- isolation suite re-derives hosted_events automatically.
-- ============================================================================

alter table hosted_events
  add column if not exists host_contact text;
