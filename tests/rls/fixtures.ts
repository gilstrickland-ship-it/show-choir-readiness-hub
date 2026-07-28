// ============================================================================
// Octv Platform — RLS fixtures (T004)
// ----------------------------------------------------------------------------
// Stable, human-readable UUIDs for the two-program seed. Fixed ids (not
// gen_random_uuid()) so the specs can reference exact seed rows without having
// to round-trip through the DB. `a…` ids belong to program A, `b…` to program B.
// ============================================================================

/** Deterministic v4-shaped UUID: <prefix>0000000-0000-4000-8000-<12-hex-of-n>. */
function fid(prefix: 'a' | 'b', n: number): string {
  return `${prefix}0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Entity → slot number. Shared by both programs so A/B structures mirror. */
const SLOT = {
  program: 1,
  season_active: 2,
  season_archived: 3,
  user_director: 4,
  user_admin: 5,
  user_treasurer: 6,
  user_costume: 7,
  user_board: 8,
  ensemble: 9,
  student: 10,
  guardian: 11,
  ensemble_member: 12,
  competition: 13,
  competition_result: 14,
  attendance: 15,
  document: 16,
  costume_set: 17,
  costume_piece: 18,
  costume_assignment: 19,
  costume_checkout: 20,
  trip: 21,
  travel_group_room: 22,
  travel_group_bus: 23,
  travel_assignment: 24,
  travel_chaperone: 25,
  budget: 26,
  budget_category: 27,
  budget_line: 28,
  ledger_live: 29,
  ledger_audit: 30,
  shift: 31,
  shift_signup: 32,
  announcement: 33,
  announcement_send: 34,
  digest: 35,
  digest_send: 36,
  guardian_token: 37,
  share_link: 38,
  token_event: 39,
  member_director: 40,
  member_admin: 41,
  member_treasurer: 42,
  member_costume: 43,
  member_board: 44,
  itinerary: 45,
  itinerary_item: 46,
  packet_parse: 47,
  absence_request: 48,
  event: 49,
  hosted_event: 50,
  hosted_school: 51,
  hosted_slot: 52,
  ledger_reconciliation: 53,
  competition_ensemble: 54,
  event_ensemble: 55,
  // Commitments (0021): one spending purchase order and one expected-money row
  // per program, both still 'requested' — the state a commitment is born in.
  commitment: 56,
  commitment_expected: 57,
  // A-only archived-season extras + ledger states (slots ≥ 60)
  competition_archived: 60,
  costume_set_archived: 61,
  budget_archived: 62,
  budget_category_archived: 63,
  budget_line_archived: 64,
  ledger_voided: 65,
  ledger_audit_extra: 66,
  hosted_event_archived: 67,
  // A live entry with NO budget line — what categorize_ledger_entry operates on.
  ledger_uncategorized: 68,
  // Octv support user (is_support = true, NOT a member of any program). Slot in
  // both A and B id-spaces resolves to the same person only via the `S` export;
  // kept ≥ 70 so it never collides with per-program slots.
  support_user: 70,
  // A-only commitment states (slots ≥ 71, clear of the support slot): one
  // approved by the treasurer against the director's request — the shape the
  // self-approval and revise-an-approved-document rules are proved on — and one
  // on the archived season.
  commitment_approved: 71,
  commitment_archived: 72,
} as const;

type Slot = keyof typeof SLOT;

export interface ProgramIds {
  program: string;
  seasonActive: string;
  seasonArchived: string;
  director: string;
  admin: string;
  treasurer: string;
  costume: string;
  board: string;
  ensemble: string;
  student: string;
  guardian: string;
  ensembleMember: string;
  competition: string;
  competitionResult: string;
  attendance: string;
  document: string;
  costumeSet: string;
  costumePiece: string;
  costumeAssignment: string;
  costumeCheckout: string;
  trip: string;
  travelGroupRoom: string;
  travelGroupBus: string;
  travelAssignment: string;
  travelChaperone: string;
  budget: string;
  budgetCategory: string;
  budgetLine: string;
  ledgerLive: string;
  ledgerUncategorized: string;
  ledgerAudit: string;
  shift: string;
  shiftSignup: string;
  announcement: string;
  announcementSend: string;
  digest: string;
  digestSend: string;
  guardianToken: string;
  shareLink: string;
  tokenEvent: string;
  memberDirector: string;
  memberAdmin: string;
  memberTreasurer: string;
  memberCostume: string;
  memberBoard: string;
  itinerary: string;
  itineraryItem: string;
  packetParse: string;
  absenceRequest: string;
  event: string;
  hostedEvent: string;
  hostedSchool: string;
  hostedSlot: string;
  ledgerReconciliation: string;
  competitionEnsemble: string;
  eventEnsemble: string;
  commitment: string;
  commitmentExpected: string;
  // A-only
  commitmentApproved: string;
  commitmentArchived: string;
  competitionArchived: string;
  costumeSetArchived: string;
  budgetArchived: string;
  budgetCategoryArchived: string;
  budgetLineArchived: string;
  ledgerVoided: string;
  ledgerAuditExtra: string;
  hostedEventArchived: string;
}

function build(prefix: 'a' | 'b'): ProgramIds {
  const g = (s: Slot) => fid(prefix, SLOT[s]);
  return {
    program: g('program'),
    seasonActive: g('season_active'),
    seasonArchived: g('season_archived'),
    director: g('user_director'),
    admin: g('user_admin'),
    treasurer: g('user_treasurer'),
    costume: g('user_costume'),
    board: g('user_board'),
    ensemble: g('ensemble'),
    student: g('student'),
    guardian: g('guardian'),
    ensembleMember: g('ensemble_member'),
    competition: g('competition'),
    competitionResult: g('competition_result'),
    attendance: g('attendance'),
    document: g('document'),
    costumeSet: g('costume_set'),
    costumePiece: g('costume_piece'),
    costumeAssignment: g('costume_assignment'),
    costumeCheckout: g('costume_checkout'),
    trip: g('trip'),
    travelGroupRoom: g('travel_group_room'),
    travelGroupBus: g('travel_group_bus'),
    travelAssignment: g('travel_assignment'),
    travelChaperone: g('travel_chaperone'),
    budget: g('budget'),
    budgetCategory: g('budget_category'),
    budgetLine: g('budget_line'),
    ledgerLive: g('ledger_live'),
    ledgerUncategorized: g('ledger_uncategorized'),
    ledgerAudit: g('ledger_audit'),
    shift: g('shift'),
    shiftSignup: g('shift_signup'),
    announcement: g('announcement'),
    announcementSend: g('announcement_send'),
    digest: g('digest'),
    digestSend: g('digest_send'),
    guardianToken: g('guardian_token'),
    shareLink: g('share_link'),
    tokenEvent: g('token_event'),
    memberDirector: g('member_director'),
    memberAdmin: g('member_admin'),
    memberTreasurer: g('member_treasurer'),
    memberCostume: g('member_costume'),
    memberBoard: g('member_board'),
    itinerary: g('itinerary'),
    itineraryItem: g('itinerary_item'),
    packetParse: g('packet_parse'),
    absenceRequest: g('absence_request'),
    event: g('event'),
    hostedEvent: g('hosted_event'),
    hostedSchool: g('hosted_school'),
    hostedSlot: g('hosted_slot'),
    ledgerReconciliation: g('ledger_reconciliation'),
    competitionEnsemble: g('competition_ensemble'),
    eventEnsemble: g('event_ensemble'),
    commitment: g('commitment'),
    commitmentExpected: g('commitment_expected'),
    commitmentApproved: g('commitment_approved'),
    commitmentArchived: g('commitment_archived'),
    competitionArchived: g('competition_archived'),
    costumeSetArchived: g('costume_set_archived'),
    budgetArchived: g('budget_archived'),
    budgetCategoryArchived: g('budget_category_archived'),
    budgetLineArchived: g('budget_line_archived'),
    ledgerVoided: g('ledger_voided'),
    ledgerAuditExtra: g('ledger_audit_extra'),
    hostedEventArchived: g('hosted_event_archived'),
  };
}

export const A: ProgramIds = build('a');
export const B: ProgramIds = build('b');

// Octv support user — a single global identity (not tied to A or B), used by the
// support-access spec. is_support = true, no program membership. Program A grants
// support consent (support_access_until in the future); program B does not.
export const SUPPORT_USER = fid('a', SLOT.support_user);
