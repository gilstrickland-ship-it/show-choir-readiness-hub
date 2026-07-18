-- ============================================================================
-- Octv Platform — Roster settings migration (T006)
-- ----------------------------------------------------------------------------
-- Programs measure differently, so the roster's `students.sizes` jsonb keys are
-- program-defined (architecture-spec §3, open decision §14.4). This adds the
-- program-level list of size-field keys that the roster UI and CSV import read
-- to generate size inputs and match size columns.
--
-- `feature_overrides` is the flag store, not a config bucket — so size config
-- gets its own column. Array of key strings; default mirrors the jsonb example
-- keys in students.sizes. No RLS changes needed: the existing programs_read /
-- programs_write policies (0002_rls.sql) already gate this column, and only
-- director/admin can write programs.
-- ============================================================================

alter table programs
  add column size_fields jsonb not null default '["top","bottom","shoe"]'::jsonb;
