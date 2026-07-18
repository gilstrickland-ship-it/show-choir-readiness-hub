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
    redirect(`/${slug}/settings?error=missing`);
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
    redirect(`/${slug}/settings?error=save`);
  }
  revalidatePath(`/${slug}/settings`);
  redirect(`/${slug}/settings?saved=1`);
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
    redirect(`/${slug}/settings/members?error=invite`);
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
    redirect(`/${slug}/settings/members?error=invite`);
  }

  // Best-effort transactional invite email. Failure is non-fatal — the members
  // page shows the invite link to copy manually.
  try {
    const admin = createAdminClient();
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${await origin()}/invite/${created.id}`,
    });
  } catch {
    // Ignore — link is surfaced in the UI.
  }

  revalidatePath(`/${slug}/settings/members`);
  redirect(`/${slug}/settings/members?invited=${created.id}`);
}

// Re-role a member (single dropdown per §2). Blocks demoting the last director.
export async function reRoleMember(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  await requireRole(programId, SETTINGS_ROLES);

  if (!VALID_ROLES.includes(role)) {
    redirect(`/${slug}/settings/members?error=role`);
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
    redirect(`/${slug}/settings/members?error=last_director`);
  }

  const { error } = await supabase
    .from("program_members")
    .update({ role })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/settings/members?error=role`);
  }
  revalidatePath(`/${slug}/settings/members`);
  redirect(`/${slug}/settings/members?saved=1`);
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
    redirect(`/${slug}/settings/members?error=last_director`);
  }

  const { error } = await supabase
    .from("program_members")
    .update({ status: "removed" })
    .eq("id", memberId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/settings/members?error=remove`);
  }
  revalidatePath(`/${slug}/settings/members`);
  redirect(`/${slug}/settings/members?saved=1`);
}

// ---------------------------------------------------------------------------
// Support access (§10, T030). Director grants a 7-day read-only window to
// support staff, or revokes it immediately. RLS (0004) is the real gate; this just
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
    redirect(`/${slug}/settings?error=support`);
  }
  revalidatePath(`/${slug}/settings`);
  redirect(`/${slug}/settings?saved=1`);
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
    redirect(`/${slug}/settings?error=support`);
  }
  revalidatePath(`/${slug}/settings`);
  redirect(`/${slug}/settings?saved=1`);
}

// ---------------------------------------------------------------------------
// Share links (FR-002 / §8a). director/admin revoke a broadcast link from the
// Settings listing. Minting happens where the resource lives (itinerary page,
// shifts page); revocation is centralized here. RLS (share_links_write) is the
// real gate; requireRole re-checks (Constitution I).
// ---------------------------------------------------------------------------

export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const shareLinkId = String(formData.get("shareLinkId") ?? "");
  await requireRole(programId, SETTINGS_ROLES);

  const supabase = await createClient();
  await revokeShareLink(supabase, { programId, shareLinkId });

  revalidatePath(`/${slug}/settings`);
  redirect(`/${slug}/settings?saved=1`);
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
    redirect(`/${slug}/settings/rollover?error=archive`);
  }
  revalidatePath(`/${slug}/settings/rollover`);
  redirect(`/${slug}/settings/rollover?archived=1`);
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
    redirect(`/${slug}/settings/rollover?error=unarchive`);
  }
  revalidatePath(`/${slug}/settings/rollover`);
  redirect(`/${slug}/settings/rollover?unarchived=1`);
}
