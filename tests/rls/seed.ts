// ============================================================================
// Octv Platform — RLS seed (T004)
// ----------------------------------------------------------------------------
// Two fully-populated programs (A + B), each with the complete member set and a
// row in every program-scoped table, so the isolation sweep has cross-tenant
// rows to prove denial against. Program A additionally carries an archived
// season (+ archived competition/costume set/budget) and a voided ledger entry
// so archive.spec and ledger.spec have concrete rows to exercise.
//
// Seeding runs as the superuser (RLS bypassed) in globalSetup, before any spec
// connects. Deterministic ids come from fixtures.ts.
// ============================================================================

import { Pool } from 'pg';
import { A, B, SUPPORT_USER, type ProgramIds } from './fixtures';

/** Full active-season data for one program. */
function seedProgramSql(p: ProgramIds, prefix: string): string {
  return `
-- auth users + profiles (profiles.id = auth.users.id)
insert into auth.users (id, email) values
  ('${p.director}',  '${prefix}-director@example.test'),
  ('${p.admin}',     '${prefix}-admin@example.test'),
  ('${p.treasurer}', '${prefix}-treasurer@example.test'),
  ('${p.costume}',   '${prefix}-costume@example.test'),
  ('${p.board}',     '${prefix}-board@example.test');

insert into profiles (id, full_name) values
  ('${p.director}',  '${prefix} Director'),
  ('${p.admin}',     '${prefix} Admin'),
  ('${p.treasurer}', '${prefix} Treasurer'),
  ('${p.costume}',   '${prefix} Costume Mgr'),
  ('${p.board}',     '${prefix} Board Member')
on conflict (id) do update set full_name = excluded.full_name;

insert into programs (id, name, slug, timezone) values
  ('${p.program}', '${prefix} Program', '${prefix}-program', 'America/Chicago');

insert into seasons (id, program_id, label, is_active) values
  ('${p.seasonActive}', '${p.program}', '2026-27', true);

insert into program_members (id, program_id, user_id, role, status) values
  ('${p.memberDirector}',  '${p.program}', '${p.director}',  'director',        'active'),
  ('${p.memberAdmin}',     '${p.program}', '${p.admin}',     'admin',           'active'),
  ('${p.memberTreasurer}', '${p.program}', '${p.treasurer}', 'treasurer',       'active'),
  ('${p.memberCostume}',   '${p.program}', '${p.costume}',   'costume_manager', 'active'),
  ('${p.memberBoard}',     '${p.program}', '${p.board}',     'board_member',    'active');

insert into ensembles (id, program_id, name) values
  ('${p.ensemble}', '${p.program}', 'Varsity Mixed');

insert into students (id, program_id, first_name, last_name) values
  ('${p.student}', '${p.program}', '${prefix}First', '${prefix}Last');

insert into guardians (id, program_id, student_id, name, email) values
  ('${p.guardian}', '${p.program}', '${p.student}', '${prefix} Guardian', '${prefix}-guardian@example.test');

insert into ensemble_members (id, program_id, season_id, ensemble_id, student_id, role) values
  ('${p.ensembleMember}', '${p.program}', '${p.seasonActive}', '${p.ensemble}', '${p.student}', 'performer');

insert into competitions (id, program_id, season_id, ensemble_id, name, status) values
  ('${p.competition}', '${p.program}', '${p.seasonActive}', '${p.ensemble}', '${prefix} Invitational', 'confirmed');

insert into competition_results (id, program_id, competition_id, placement) values
  ('${p.competitionResult}', '${p.program}', '${p.competition}', 'Grand Champion');

insert into attendance (id, program_id, competition_id, student_id, status) values
  ('${p.attendance}', '${p.program}', '${p.competition}', '${p.student}', 'expected');

insert into documents (id, program_id, competition_id, kind, storage_path) values
  ('${p.document}', '${p.program}', '${p.competition}', 'host_packet', '${p.program}/packet.pdf');

insert into packet_parses (id, program_id, competition_id, document_id, status) values
  ('${p.packetParse}', '${p.program}', '${p.competition}', '${p.document}', 'queued');

insert into itineraries (id, program_id, competition_id, status) values
  ('${p.itinerary}', '${p.program}', '${p.competition}', 'draft');

insert into itinerary_items (id, itinerary_id, program_id, kind, title, sort_order) values
  ('${p.itineraryItem}', '${p.itinerary}', '${p.program}', 'perform', 'Take the stage', 0);

insert into absence_requests (id, program_id, competition_id, student_id, guardian_id, note, status) values
  ('${p.absenceRequest}', '${p.program}', '${p.competition}', '${p.student}', '${p.guardian}', 'sick', 'pending');

insert into events (id, program_id, season_id, title, kind) values
  ('${p.event}', '${p.program}', '${p.seasonActive}', 'Rehearsal', 'rehearsal');

insert into costume_sets (id, program_id, season_id, ensemble_id, name) values
  ('${p.costumeSet}', '${p.program}', '${p.seasonActive}', '${p.ensemble}', 'Opener');

insert into costume_pieces (id, program_id, set_id, kind, label) values
  ('${p.costumePiece}', '${p.program}', '${p.costumeSet}', 'dress', 'Dress #1');

insert into costume_assignments (id, program_id, season_id, piece_id, student_id) values
  ('${p.costumeAssignment}', '${p.program}', '${p.seasonActive}', '${p.costumePiece}', '${p.student}');

insert into costume_checkouts (id, program_id, competition_id, assignment_id) values
  ('${p.costumeCheckout}', '${p.program}', '${p.competition}', '${p.costumeAssignment}');

insert into trips (id, program_id, season_id, competition_id, name) values
  ('${p.trip}', '${p.program}', '${p.seasonActive}', '${p.competition}', '${prefix} Trip');

insert into travel_groups (id, program_id, trip_id, kind, label) values
  ('${p.travelGroupRoom}', '${p.program}', '${p.trip}', 'room', 'Room 214'),
  ('${p.travelGroupBus}',  '${p.program}', '${p.trip}', 'bus',  'Bus 1');

insert into travel_assignments (id, program_id, travel_group_id, student_id) values
  ('${p.travelAssignment}', '${p.program}', '${p.travelGroupRoom}', '${p.student}');

insert into travel_chaperones (id, program_id, travel_group_id, guardian_id) values
  ('${p.travelChaperone}', '${p.program}', '${p.travelGroupRoom}', '${p.guardian}');

insert into budgets (id, program_id, season_id, name, status) values
  ('${p.budget}', '${p.program}', '${p.seasonActive}', 'Season Budget', 'active');

insert into budget_categories (id, program_id, budget_id, name, direction) values
  ('${p.budgetCategory}', '${p.program}', '${p.budget}', 'Costumes', 'expense');

insert into budget_lines (id, program_id, category_id, name, planned_cents) values
  ('${p.budgetLine}', '${p.program}', '${p.budgetCategory}', 'Dresses', 500000);

insert into ledger_entries (id, program_id, season_id, direction, amount_cents, budget_line_id, entered_by, memo) values
  ('${p.ledgerLive}', '${p.program}', '${p.seasonActive}', 'out', 12500, '${p.budgetLine}', '${p.treasurer}', 'live entry');

insert into ledger_audit (id, program_id, entry_id, action, actor) values
  ('${p.ledgerAudit}', '${p.program}', '${p.ledgerLive}', 'create', '${p.treasurer}');

insert into shifts (id, program_id, season_id, competition_id, title) values
  ('${p.shift}', '${p.program}', '${p.seasonActive}', '${p.competition}', 'Concessions');

insert into shift_signups (id, program_id, shift_id, guardian_id, name, status, source) values
  ('${p.shiftSignup}', '${p.program}', '${p.shift}', '${p.guardian}', '${prefix} Guardian', 'confirmed', 'staff_entered');

insert into announcements (id, program_id, season_id, subject, status) values
  ('${p.announcement}', '${p.program}', '${p.seasonActive}', 'Welcome', 'draft');

insert into announcement_sends (id, program_id, announcement_id, email, status) values
  ('${p.announcementSend}', '${p.program}', '${p.announcement}', '${prefix}-guardian@example.test', 'queued');

insert into digests (id, program_id, week_of, status) values
  ('${p.digest}', '${p.program}', current_date, 'draft');

insert into digest_sends (id, program_id, digest_id, email) values
  ('${p.digestSend}', '${p.program}', '${p.digest}', '${prefix}-guardian@example.test');

insert into guardian_tokens (id, program_id, guardian_id, token_hash) values
  ('${p.guardianToken}', '${p.program}', '${p.guardian}', '${prefix}-guardian-token-hash');

insert into share_links (id, program_id, resource, resource_id, token_hash) values
  ('${p.shareLink}', '${p.program}', 'itinerary', '${p.itinerary}', '${prefix}-share-link-hash');

insert into token_events (id, program_id, token_kind, token_id, action) values
  ('${p.tokenEvent}', '${p.program}', 'guardian', '${p.guardianToken}', 'view');
`;
}

/** Program A only: an archived season with season-scoped rows + a voided ledger entry. */
function seedArchivedExtrasSql(p: ProgramIds): string {
  return `
insert into seasons (id, program_id, label, is_active, archived_at) values
  ('${p.seasonArchived}', '${p.program}', '2024-25', false, now());

insert into competitions (id, program_id, season_id, ensemble_id, name, status) values
  ('${p.competitionArchived}', '${p.program}', '${p.seasonArchived}', '${p.ensemble}', 'Archived Invitational', 'done');

insert into costume_sets (id, program_id, season_id, ensemble_id, name) values
  ('${p.costumeSetArchived}', '${p.program}', '${p.seasonArchived}', '${p.ensemble}', 'Archived Opener');

insert into budgets (id, program_id, season_id, name, status) values
  ('${p.budgetArchived}', '${p.program}', '${p.seasonArchived}', 'Archived Budget', 'closed');

insert into budget_categories (id, program_id, budget_id, name, direction) values
  ('${p.budgetCategoryArchived}', '${p.program}', '${p.budgetArchived}', 'Old Costumes', 'expense');

insert into budget_lines (id, program_id, category_id, name, planned_cents) values
  ('${p.budgetLineArchived}', '${p.program}', '${p.budgetCategoryArchived}', 'Old Dresses', 100000);

-- already-voided live-season entry (for the un-void rejection test)
insert into ledger_entries
  (id, program_id, season_id, direction, amount_cents, entered_by, memo, voided_at, voided_by, void_reason) values
  ('${p.ledgerVoided}', '${p.program}', '${p.seasonActive}', 'in', 9900, '${p.treasurer}', 'voided entry',
   now(), '${p.treasurer}', 'duplicate');

insert into ledger_audit (id, program_id, entry_id, action, actor) values
  ('${p.ledgerAuditExtra}', '${p.program}', '${p.ledgerVoided}', 'void', '${p.treasurer}');
`;
}

/**
 * Octv support user + consent state (T030). One support identity with
 * is_support = true and NO program membership. Program A grants support consent
 * (support_access_until in the future); program B grants none — so the spec can
 * prove support+consent reads, support-without-consent is blocked, and support
 * never writes. Because the support user is not a member and not is_support-less
 * peers of A/B, the isolation sweep (which uses A's director/etc.) is unaffected.
 */
function seedSupportSql(): string {
  return `
insert into auth.users (id, email) values
  ('${SUPPORT_USER}', 'octv-support@example.test');

insert into profiles (id, full_name, is_support) values
  ('${SUPPORT_USER}', 'Octv Support', true)
on conflict (id) do update set full_name = excluded.full_name, is_support = excluded.is_support;

-- Program A consents to support for the next day; program B leaves it null.
update programs set support_access_until = now() + interval '1 day' where id = '${A.program}';

-- Durable support-view audit rows (T035). One per program so the spec can prove
-- a program's own director/admin/board reads ITS log, and never program B's.
insert into support_access_log (program_id, support_user_id, path) values
  ('${A.program}', '${SUPPORT_USER}', '/A-program/dashboard'),
  ('${B.program}', '${SUPPORT_USER}', '/B-program/dashboard');
`;
}

export async function seedDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(seedProgramSql(A, 'A'));
      await c.query(seedProgramSql(B, 'B'));
      await c.query(seedArchivedExtrasSql(A));
      await c.query(seedSupportSql());
      await c.query('commit');
    } catch (err) {
      await c.query('rollback').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}
