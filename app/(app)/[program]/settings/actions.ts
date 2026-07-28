"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, type Role } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { supportAccessUntilFromNow } from "@/lib/support";
import { revokeShareLink } from "@/lib/tokens";
import { programPath } from "@/lib/return-path";
import {
  isMemberRowError,
  settingsErrorAnchor,
  settingsOkAnchor,
  staffMemberAnchor,
  type MemberErrorKey,
  type MemberOkKey,
  type SettingsErrorKey,
  type SettingsOkKey,
} from "./shared";
import {
  rolloverErrorAnchor,
  rolloverOkAnchor,
  type RolloverErrorKey,
  type RolloverOkKey,
} from "./rollover/shared";

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/settings",
// which every browser reads as a different ORIGIN and follows off-site.
// programPath validates the slug shape and fails closed to "/" (spec 005 T143a).
function settingsPath(slug: string, sub = ""): string {
  return programPath(slug, sub ? `settings/${sub}` : "settings") ?? "/";
}

// Where a message goes is the MAP's answer, not this file's (./shared) — the
// anchor a redirect scrolls to and the block that renders the message are read
// from the same place, so they cannot drift (spec 005 Wave 13 / T164).
function settingsDone(slug: string, key: SettingsOkKey): string {
  return `${settingsPath(slug)}?ok=${key}#${settingsOkAnchor(key)}`;
}

function settingsFail(slug: string, key: SettingsErrorKey): string {
  return `${settingsPath(slug)}?error=${key}#${settingsErrorAnchor(key)}`;
}

// A member failure that belongs to ONE row goes back to that row: `?edit=` names
// it, and the page renders the message inside the panel that produced it instead
// of at the top of a list the director then has to scan to find their person.
function memberFail(
  slug: string,
  key: MemberErrorKey,
  memberId?: string,
): string {
  const base = settingsPath(slug, "members");
  if (isMemberRowError(key) && memberId) {
    const id = encodeURIComponent(memberId);
    return `${base}?edit=${id}&error=${key}#${staffMemberAnchor(id)}`;
  }
  return `${base}?error=${key}`;
}

function memberDone(slug: string, key: MemberOkKey): string {
  return `${settingsPath(slug, "members")}?ok=${key}`;
}

function seasonsDone(slug: string, key: RolloverOkKey): string {
  return `${settingsPath(slug, "rollover")}?ok=${key}#${rolloverOkAnchor(key)}`;
}

function seasonsFail(slug: string, key: RolloverErrorKey): string {
  return `${settingsPath(slug, "rollover")}?error=${key}#${rolloverErrorAnchor(key)}`;
}

// Season archive/unarchive + support access are director-only (unarchive and the
// support-consent toggle are the most consequential lifecycle switches; §10, §9.4).
const DIRECTOR_ONLY: readonly Role[] = ["director"];

// Settings mutations. Every action re-checks director/admin against
// program_members via requireRole (Constitution I, defense in depth) even though
// RLS already gates the write — the UI hiding the form is not authorization.

const VALID_ROLES: readonly Role[] = [
  "director",
  "admin",
  "treasurer",
  "costume_manager",
  "board_member",
];

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

// Ensure a confirmed auth user exists for `email` so magic-link sign-in works
// for a first-time invitee (F2). Checks existence first (listUsers scan) and
// only creates when absent; createUser is itself idempotent (it errors if the
// email already exists), so a race just no-ops. Callers wrap this in try/catch.
type AdminClient = ReturnType<typeof createAdminClient>;
async function ensureAuthUser(admin: AdminClient, email: string): Promise<void> {
  const target = email.toLowerCase();
  // Scan a bounded number of pages; a program's staff base is tiny, and this is
  // only an optimization to avoid a redundant createUser error.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const users = data?.users ?? [];
    if (users.some((u) => (u.email ?? "").toLowerCase() === target)) return;
    if (users.length < 200) break; // last page
  }
  await admin.auth.admin.createUser({ email, email_confirm: true });
}

// Count active directors so we never leave a program without one.
async function activeDirectorCount(programId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("program_members")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId)
    .eq("status", "active")
    .eq("role", "director");
  return count ?? 0;
}

// Program settings: name, timezone (IANA), school/city/state. director/admin.
export async function updateProgram(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!name || !timezone) {
    redirect(settingsFail(slug, "missing"));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({
      name,
      timezone,
      school_name: String(formData.get("school_name") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      state: String(formData.get("state") ?? "").trim() || null,
    })
    .eq("id", programId);

  if (error) {
    redirect(settingsFail(slug, "save"));
  }
  revalidatePath(settingsPath(slug));
  redirect(settingsDone(slug, "saved"));
}

// Invite a member: create an `invited` program_members row, then best-effort
// send a Supabase invite email. The invite link (/invite/<id>) is surfaced on
// the members page regardless, so onboarding works even without email delivery.
export async function inviteMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as Role;
  if (!email || !VALID_ROLES.includes(role)) {
    redirect(memberFail(slug, "invite"));
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("program_members")
    .insert({
      program_id: programId,
      role,
      status: "invited",
      invited_email: email,
    })
    .select("id")
    .single();

  if (error || !created) {
    redirect(memberFail(slug, "invite"));
  }

  // Best-effort transactional invite email. Failure is non-fatal — the members
  // page shows the invite link to copy manually.
  const admin = createAdminClient();
  try {
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${await origin()}/invite/${created.id}`,
    });
  } catch {
    // Ignore — link is surfaced in the UI.
  }

  // Ensure an auth user actually exists for this email. inviteUserByEmail can
  // fail (no SMTP configured, transient error) and swallow the user creation,
  // which strands a first-time invitee: password sign-in fails, and magic-link
  // sign-in uses shouldCreateUser:false so it refuses an email with no account.
  // Creating a confirmed user here makes "Email me a sign-in link" work for
  // them. Idempotent + best-effort: if the user already exists, ignore.
  try {
    await ensureAuthUser(admin, email);
  } catch {
    // Ignore — link is surfaced in the UI regardless.
  }

  revalidatePath(settingsPath(slug, "members"));
  // `?invited=` is DATA, not a message: it is the one moment the full invite URL
  // is knowable, and the page shows it once so onboarding works even where email
  // delivery isn't configured.
  redirect(
    `${settingsPath(slug, "members")}?invited=${encodeURIComponent(created.id)}`,
  );
}

// Re-role a member (single dropdown per §2). Blocks demoting the last director.
export async function reRoleMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  await requireRole(programId, SETTINGS_ROLES);

  if (!VALID_ROLES.includes(role)) {
    redirect(memberFail(slug, "role", memberId));
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("program_members")
    .select("role, status")
    .eq("id", memberId)
    .eq("program_id", programId)
    .maybeSingle();

  if (
    target?.status === "active" &&
    target.role === "director" &&
    role !== "director" &&
    (await activeDirectorCount(programId)) <= 1
  ) {
    redirect(memberFail(slug, "last_director", memberId));
  }

  const { error } = await supabase
    .from("program_members")
    .update({ role })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(memberFail(slug, "role", memberId));
  }
  revalidatePath(settingsPath(slug, "members"));
  redirect(memberDone(slug, "saved"));
}

// Remove a member (status = 'removed'). Blocks removing the last director.
export async function removeMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("program_members")
    .select("role, status")
    .eq("id", memberId)
    .eq("program_id", programId)
    .maybeSingle();

  if (
    target?.status === "active" &&
    target.role === "director" &&
    (await activeDirectorCount(programId)) <= 1
  ) {
    redirect(memberFail(slug, "last_director", memberId));
  }

  const { error } = await supabase
    .from("program_members")
    .update({ status: "removed" })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(memberFail(slug, "remove", memberId));
  }
  revalidatePath(settingsPath(slug, "members"));
  redirect(memberDone(slug, "removed"));
}

// ---------------------------------------------------------------------------
// Support access (§10, T030). Director grants a 7-day read-only window to
// support staff, or ends it immediately. RLS (0004) is the real gate; this just
// sets/clears programs.support_access_until.
// ---------------------------------------------------------------------------

export async function grantSupportAccess(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, DIRECTOR_ONLY);

  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({ support_access_until: supportAccessUntilFromNow() })
    .eq("id", programId);

  if (error) {
    redirect(settingsFail(slug, "support"));
  }
  revalidatePath(settingsPath(slug));
  redirect(settingsDone(slug, "granted"));
}

export async function revokeSupportAccess(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, DIRECTOR_ONLY);

  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({ support_access_until: null })
    .eq("id", programId);

  if (error) {
    redirect(settingsFail(slug, "support"));
  }
  revalidatePath(settingsPath(slug));
  redirect(settingsDone(slug, "ended"));
}

// ---------------------------------------------------------------------------
// Share links (FR-002 / §8a). director/admin revoke a broadcast link from the
// Settings listing. Minting happens where the resource lives (itinerary page,
// shifts page, season page); revocation is centralized here. RLS
// (share_links_write) is the real gate; requireRole re-checks (Constitution I).
// ---------------------------------------------------------------------------

export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const shareLinkId = String(formData.get("shareLinkId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  // revokeShareLink is program-scoped, so a link id from another program matches
  // nothing and this is a no-op rather than a cross-tenant write (Constitution I).
  const supabase = await createClient();
  await revokeShareLink(supabase, { programId, shareLinkId });

  revalidatePath(settingsPath(slug));
  redirect(settingsDone(slug, "revoked"));
}

// ---------------------------------------------------------------------------
// Season archive / unarchive (§9.4, invariant 4). Archiving sets
// seasons.archived_at → all season-scoped writes are frozen by RLS (the vault).
// Archive is director/admin; unarchive is director-only. Guarded so a program
// never loses its only active season by archiving it — you deactivate first.
// ---------------------------------------------------------------------------

export async function archiveSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("seasons")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", seasonId)
    .eq("program_id", programId)
    .is("archived_at", null);

  if (error) {
    redirect(seasonsFail(slug, "archive"));
  }
  revalidatePath(settingsPath(slug, "rollover"));
  redirect(seasonsDone(slug, "archived"));
}

export async function unarchiveSeason(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, DIRECTOR_ONLY);

  const supabase = await createClient();
  const { error } = await supabase
    .from("seasons")
    .update({ archived_at: null })
    .eq("id", seasonId)
    .eq("program_id", programId);

  if (error) {
    redirect(seasonsFail(slug, "unarchive"));
  }
  revalidatePath(settingsPath(slug, "rollover"));
  redirect(seasonsDone(slug, "unarchived"));
}
