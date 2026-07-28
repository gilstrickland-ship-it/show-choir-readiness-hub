import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

// ============================================================================
// Shared helpers for the end-to-end USER JOURNEY suite.
// ----------------------------------------------------------------------------
// - Admin (service-role) Supabase client for arranging test preconditions that
//   the app itself can't set up (accepting invites, resetting round-trip state).
// - A password sign-in helper that drives the real /sign-in surface.
// - A tiny on-disk state file (written by global-setup) carrying the pre-minted
//   guardian token + the created auth users' ids. global-setup and the specs run
//   in separate processes, so the file — not process.env — is the handoff.
// ============================================================================

export const STATE_FILE = join(process.cwd(), "tests/e2e/.e2e-state.json");

// Fixed seed UUIDs (supabase/seed.sql) the journeys reference.
export const DEMO = {
  programId: "d0000000-0000-4000-8000-000000000001",
  slug: "demo",
  seasonId: "d0000000-0000-4000-8000-000000000002",
  directorMembershipId: "d0000000-0000-4000-8000-000000006001",
  treasurerMembershipId: "d0000000-0000-4000-8000-000000006002",
  costumeMembershipId: "d0000000-0000-4000-8000-000000006003",
  boardMembershipId: "d0000000-0000-4000-8000-000000006004",
  varsityEnsembleId: "d0000000-0000-4000-8000-000000000010", // Varsity Mixed
  openerSetId: "d0000000-0000-4000-8000-000000000030", // the "Opener" costume set
  guardianId: "d0000000-0000-4000-8000-000000000201", // Diane Bennett
  avaStudentId: "d0000000-0000-4000-8000-000000000101", // Ava Bennett
  liamStudentId: "d0000000-0000-4000-8000-000000000102", // Liam Carter
  competitionId: "d0000000-0000-4000-8000-000000000020", // Central Illinois Invitational
  lunchShiftId: "d0000000-0000-4000-8000-000000005401", // Meal crew — Lunch
} as const;

// Test auth users (created idempotently in global-setup, which force-resets
// them to these passwords). The director/board emails match seeded invited
// memberships.
export const USERS = {
  director: { email: "director@demo.example", password: "test1234" },
  founder: { email: "fresh-founder@e2e.test", password: "test1234" },
  board: { email: "board@demo.example", password: "test1234" },
  treasurer: { email: "treasurer@demo.example", password: "test1234" },
  costume: { email: "costumes@demo.example", password: "test1234" },
} as const;

export interface E2EState {
  guardianRawToken: string;
  userIds: Record<string, string>;
}

export function writeState(state: E2EState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function readState(): E2EState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `E2E state file missing (${STATE_FILE}). global-setup must run first.`,
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;
}

// Service-role admin client. Accepts either the SUPABASE_URL/SERVICE_ROLE_KEY
// pair (what `supabase status -o env` exports) or the app's NEXT_PUBLIC_/
// SUPABASE_SERVICE_ROLE_KEY names, so it works no matter which the CI mapped.
export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env missing — set SUPABASE_URL + SERVICE_ROLE_KEY " +
        "(from `supabase status -o env`).",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ---- App sign-in (real /sign-in surface, password grant) -------------------

export async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  // Two forms carry an "Email" field (password + magic-link) — scope to the one
  // that has the password input so getByLabel("Email") is unambiguous.
  const form = page.locator("form", {
    has: page.locator('input[name="password"]'),
  });
  await form.getByLabel("Email").fill(email);
  // exact: true — the show/hide toggle's aria-label ("Show password") would
  // otherwise also match getByLabel's substring semantics.
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
  // The action redirects to /launch, which routes onward — just leave /sign-in.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 20_000,
  });
}

// ---- Admin preconditions ---------------------------------------------------

// Flip a seeded invited membership to active + linked to its auth user — the
// programmatic equivalent of accepting the invite, so specs that act AS a member
// are re-run-safe and order-independent.
export async function ensureMembershipActive(
  membershipId: string,
  email: string,
): Promise<void> {
  const admin = adminClient();
  const userId = readState().userIds[email];
  if (!userId) throw new Error(`No stored user id for ${email}`);
  const { error } = await admin
    .from("program_members")
    .update({ status: "active", user_id: userId })
    .eq("id", membershipId);
  if (error) throw new Error(`ensureMembershipActive failed: ${error.message}`);
}

// Reset a membership back to the pristine invited state so the invite-acceptance
// UI flow can be exercised regardless of what earlier specs did.
export async function resetMembershipInvited(membershipId: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("program_members")
    .update({ status: "invited", user_id: null })
    .eq("id", membershipId);
  if (error) throw new Error(`resetMembershipInvited failed: ${error.message}`);
}

// Remove any program(s) the fresh founder created in a prior run so the F1
// journey always lands on the deterministic `e2e-test-program` slug and the
// "Start your program" empty state.
export async function cleanupFounderPrograms(): Promise<void> {
  const admin = adminClient();
  const founderId = readState().userIds[USERS.founder.email];
  const ids = new Set<string>();
  if (founderId) {
    const { data: mems } = await admin
      .from("program_members")
      .select("program_id")
      .eq("user_id", founderId);
    for (const m of (mems as { program_id: string }[] | null) ?? [])
      ids.add(m.program_id);
  }
  const { data: progs } = await admin
    .from("programs")
    .select("id")
    .ilike("slug", "e2e-test-program%");
  for (const p of (progs as { id: string }[] | null) ?? []) ids.add(p.id);

  const list = [...ids];
  if (list.length === 0) return;
  // Children before parents (FK order).
  await admin.from("ensemble_members").delete().in("program_id", list);
  await admin.from("costume_sets").delete().in("program_id", list);
  await admin.from("seasons").delete().in("program_id", list);
  await admin.from("program_members").delete().in("program_id", list);
  await admin.from("programs").delete().in("id", list);
}

// Mint a BROADCAST share link straight into the database and hand back the raw
// token — the same hash-only shape global-setup uses for the guardian token, and
// the only way a spec can hold a raw share token (the app shows one exactly once,
// on the redirect after minting). Idempotent per resource: prior links for the
// same resource are revoked first, so a re-run never leaves two live.
export async function mintShareToken(args: {
  resource: "itinerary" | "signup_page" | "season_calendar";
  resourceId: string;
}): Promise<string> {
  const admin = adminClient();
  const raw = randomBytes(32).toString("base64url");
  await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("program_id", DEMO.programId)
    .eq("resource", args.resource)
    .eq("resource_id", args.resourceId)
    .is("revoked_at", null);
  const { error } = await admin.from("share_links").insert({
    program_id: DEMO.programId,
    resource: args.resource,
    resource_id: args.resourceId,
    token_hash: sha256Hex(raw),
  });
  if (error) throw new Error(`share_links insert failed: ${error.message}`);
  return raw;
}

// Revoke every live share link the demo program has, so a spec that minted one
// leaves the tenant as it found it.
export async function revokeAllDemoShareLinks(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("program_id", DEMO.programId)
    .is("revoked_at", null);
}

// What supabase/seed.sql gives the demo program. Anything that changes flags has
// to put THIS back, not `{}`: two of the demo's features are on by override, and
// restoring an empty object would silently turn the AI surfaces off for every
// spec that runs afterwards in this single-worker suite.
export const DEMO_FEATURE_OVERRIDES: Record<string, boolean> = {
  packet_parse: true,
  digest: true,
};

// Set the demo program's per-program feature overrides, on top of the seeded
// baseline. The parent surface evaluates the OWNING program's flags, so this is
// how a spec proves a flag-off surface actually refuses. Always pair it with
// resetDemoFeatureOverrides() in an afterAll.
export async function setDemoFeatureOverrides(
  overrides: Record<string, boolean>,
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("programs")
    .update({
      feature_overrides: { ...DEMO_FEATURE_OVERRIDES, ...overrides },
    })
    .eq("id", DEMO.programId);
  if (error) {
    throw new Error(`setDemoFeatureOverrides failed: ${error.message}`);
  }
}

export async function resetDemoFeatureOverrides(): Promise<void> {
  await setDemoFeatureOverrides({});
}

// Clear every commitment the demo program has, and any ledger entry booked
// against one, so the commitments journey starts from an empty list on every
// run. Children before parents: the audit rows and the drawdown links both carry
// a foreign key to the commitment.
//
// Deleting is a SERVICE-ROLE act and deliberately not something the app can do —
// a commitment is closed or cancelled, never removed (0021 has no delete policy,
// exactly like the ledger). This is fixture teardown, not a feature.
export async function resetDemoCommitments(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("ledger_entries")
    .delete()
    .eq("program_id", DEMO.programId)
    .not("commitment_id", "is", null);
  await admin.from("commitment_audit").delete().eq("program_id", DEMO.programId);
  await admin.from("commitments").delete().eq("program_id", DEMO.programId);
}

// The three spending rules (spec 006 D6). A spec that turns one on has to put
// the shipped defaults back, or the next spec in this single-worker suite runs
// against a program whose policy it never chose.
export async function setDemoSpendingRules(rules: {
  secondApproverCents?: number;
  boardApprovalCents?: number;
  threeQuotesCents?: number;
}): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("programs")
    .update({
      commitment_second_approver_cents: rules.secondApproverCents ?? 25000,
      commitment_board_approval_cents: rules.boardApprovalCents ?? 100000,
      commitment_three_quotes_cents: rules.threeQuotesCents ?? 50000,
    })
    .eq("id", DEMO.programId);
  if (error) throw new Error(`setDemoSpendingRules failed: ${error.message}`);
}

// Reset the demo program's parent-round-trip state so the F13/F15/F16 journey is
// deterministic: no stale absence requests / signups, and Ava back to expected.
export async function resetDemoParentState(): Promise<void> {
  const admin = adminClient();
  await admin.from("absence_requests").delete().eq("program_id", DEMO.programId);
  await admin.from("shift_signups").delete().eq("program_id", DEMO.programId);
  await admin
    .from("attendance")
    .update({ status: "expected", note: null })
    .eq("program_id", DEMO.programId)
    .eq("competition_id", DEMO.competitionId)
    .eq("student_id", DEMO.avaStudentId);
}
