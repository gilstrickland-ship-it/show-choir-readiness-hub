-- ============================================================================
-- Platform — Day-before volunteer-shift reminders
-- ----------------------------------------------------------------------------
-- Adds an idempotency stamp so the daily shift-reminder cron
-- (lib/inngest/functions/shift-reminder.ts) reminds each confirmed signup at
-- most once. The cron finds shifts starting in the next 24–48h whose confirmed,
-- guardian-linked signups have reminded_at IS NULL, stamps reminded_at, then
-- sends — so an Inngest retry never double-mails a family.
--
-- Column add only: no new RLS policies needed. shift_signups already carries the
-- shift_signups_read/_write policies from 0002_rls.sql, which cover every column;
-- the anonymous token surface writes signups via the service-role client (RLS
-- floor stays closed to anon, proven in tests/rls/tokens.spec.ts).
-- ============================================================================

alter table shift_signups
  add column reminded_at timestamptz;
