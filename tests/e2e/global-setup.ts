import { randomBytes } from "node:crypto";
import type { FullConfig } from "@playwright/test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  adminClient,
  sha256Hex,
  writeState,
  DEMO,
  USERS,
  type E2EState,
} from "./helpers";

// ============================================================================
// Playwright globalSetup — runs once before the suite (own process).
// ----------------------------------------------------------------------------
// Talks straight to the local Supabase stack (service-role) that `supabase
// start` brought up in CI. It:
//   1. creates the three test auth users (idempotent, email pre-confirmed);
//   2. pre-mints a guardian token for the seeded 'Diane Bennett' guardian by
//      inserting the sha256 of a fresh random raw token, and hands the RAW token
//      to the specs via the on-disk state file (hash-only storage means the raw
//      is knowable only here, at mint time);
//   3. persists the created user ids so specs can accept invites via admin.
// It does NOT touch the Next server — purely a DB/auth arrangement step.
// ============================================================================

async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

// Create the user, or (on re-run) find it and force a known password + confirmed
// email so password sign-in is guaranteed to work.
async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!created.error && created.data.user) return created.data.user.id;

  const existing = await findUserByEmail(admin, email);
  if (!existing) {
    throw new Error(
      `Could not create or locate auth user ${email}: ${created.error?.message}`,
    );
  }
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`updateUserById failed for ${email}: ${error.message}`);
  return existing.id;
}

async function mintGuardianToken(admin: SupabaseClient): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const hash = sha256Hex(raw);
  // Idempotent: drop any tokens from a prior run for this guardian, then insert.
  await admin.from("guardian_tokens").delete().eq("guardian_id", DEMO.guardianId);
  const { error } = await admin.from("guardian_tokens").insert({
    program_id: DEMO.programId,
    guardian_id: DEMO.guardianId,
    token_hash: hash,
  });
  if (error) throw new Error(`guardian_tokens insert failed: ${error.message}`);
  return raw;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  const admin = adminClient();

  // Fail loudly if the seed didn't run — every spec depends on the demo tenant.
  const { data: demo, error: demoErr } = await admin
    .from("programs")
    .select("id, slug")
    .eq("id", DEMO.programId)
    .maybeSingle();
  if (demoErr) {
    throw new Error(
      `Supabase not reachable / not seeded: ${demoErr.message}. ` +
        "Did `supabase start` + `supabase db reset` run?",
    );
  }
  if (!demo) {
    throw new Error(
      "Demo Show Choir seed row missing — run `supabase db reset` so " +
        "supabase/seed.sql is applied before the e2e suite.",
    );
  }

  const userIds: Record<string, string> = {};
  for (const { email, password } of Object.values(USERS)) {
    userIds[email] = await ensureAuthUser(admin, email, password);
  }

  const guardianRawToken = await mintGuardianToken(admin);

  const state: E2EState = { guardianRawToken, userIds };
  writeState(state);

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] global-setup ready — ${Object.keys(userIds).length} auth users, ` +
      "guardian token minted.",
  );
}

export default globalSetup;
