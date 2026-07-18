"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type Role } from "@/lib/auth";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { zonedWallToUtc } from "@/lib/datetime";
import { mintShareLink, revokeShareLinksForResource } from "@/lib/tokens";

// Minting/revoking share links is director/admin only — the share_links RLS
// write policy gates on those roles, so treasurer/costume_manager (who can edit
// shifts) still cannot broadcast a signup link.
const SHARE_LINK_ROLES: readonly Role[] = ["director", "admin"];

// Shift management server actions (§8, T024). Writes are director/admin/treasurer/
// costume_manager (SHIFT_WRITE_ROLES; matches the shifts_write RLS policy). Staff
// add signups on a parent's behalf (source 'staff_entered') and cancel any
// signup; parent self-service claim/cancel lives on the tokenized surface (§8a).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function shiftsPath(slug: string): string {
  return `/${slug}/comms/shifts`;
}

// Convert a datetime-local wall-clock value in the program tz to a UTC ISO
// string, or null when blank.
function wallToIso(fd: FormData, key: string, tz: string): string | null {
  const wall = str(fd, key);
  if (!wall) return null;
  return zonedWallToUtc(wall, tz)?.toISOString() ?? null;
}

// Resolve the attach-to selection into exactly one of competition/trip/event
// (or all null). The client sends attach_kind + the chosen id.
function attachColumns(fd: FormData): {
  competition_id: string | null;
  trip_id: string | null;
  event_id: string | null;
} {
  const kind = str(fd, "attach_kind");
  const id = str(fd, "attach_id") || null;
  return {
    competition_id: kind === "competition" ? id : null,
    trip_id: kind === "trip" ? id : null,
    event_id: kind === "event" ? id : null,
  };
}

export async function createShift(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  const tz = str(formData, "tz");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const title = str(formData, "title");
  if (!title) redirect(`${shiftsPath(slug)}?error=title`);
  if (!seasonId) redirect(`${shiftsPath(slug)}?error=season`);

  const neededRaw = Number(str(formData, "needed_count"));
  const needed = Number.isFinite(neededRaw) && neededRaw > 0 ? Math.floor(neededRaw) : 1;

  const supabase = await createClient();
  const { error } = await supabase.from("shifts").insert({
    program_id: programId,
    season_id: seasonId,
    ...attachColumns(formData),
    title,
    starts_at: wallToIso(formData, "starts_at", tz),
    ends_at: wallToIso(formData, "ends_at", tz),
    needed_count: needed,
    notes: str(formData, "notes") || null,
  });
  if (error) redirect(`${shiftsPath(slug)}?error=save`);

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?created=1`);
}

export async function updateShift(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const shiftId = str(formData, "shiftId");
  const tz = str(formData, "tz");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const title = str(formData, "title");
  if (!title) redirect(`${shiftsPath(slug)}?error=title`);
  const neededRaw = Number(str(formData, "needed_count"));
  const needed = Number.isFinite(neededRaw) && neededRaw > 0 ? Math.floor(neededRaw) : 1;

  const supabase = await createClient();
  await supabase
    .from("shifts")
    .update({
      title,
      starts_at: wallToIso(formData, "starts_at", tz),
      ends_at: wallToIso(formData, "ends_at", tz),
      needed_count: needed,
      notes: str(formData, "notes") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shiftId)
    .eq("program_id", programId);

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?saved=1`);
}

export async function deleteShift(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const shiftId = str(formData, "shiftId");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const supabase = await createClient();
  // Remove signups first (FK), then the shift.
  await supabase
    .from("shift_signups")
    .delete()
    .eq("program_id", programId)
    .eq("shift_id", shiftId);
  await supabase.from("shifts").delete().eq("id", shiftId).eq("program_id", programId);

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?deleted=1`);
}

// Staff adds a signup on a parent's behalf (source 'staff_entered'). No
// guardian_id — this is a hand-entered name/email, not a token claim.
export async function addStaffSignup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const shiftId = str(formData, "shiftId");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`${shiftsPath(slug)}?error=name`);

  const supabase = await createClient();
  await supabase.from("shift_signups").insert({
    program_id: programId,
    shift_id: shiftId,
    guardian_id: null,
    name,
    email: str(formData, "email") || null,
    status: "confirmed",
    source: "staff_entered",
  });

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?signed=1`);
}

// Staff cancels a signup (parent or staff-entered). Sets status 'cancelled' so
// the slot re-opens and the history is preserved.
export async function cancelSignup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const signupId = str(formData, "signupId");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("shift_signups")
    .update({ status: "cancelled" })
    .eq("id", signupId)
    .eq("program_id", programId);

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?cancelled=1`);
}

// Broadcast a read-only volunteer-signup browse link (FR-002 / §8a). The public
// signup page shows the ACTIVE SEASON's open shifts, so we scope the share link's
// resource_id to the season id — that is the natural unit a "sign up to help this
// season" link addresses (token resolution keys on program + resource; the
// resource_id records intent and is what Settings lists/rotates). director/admin
// only. Rotates: any active signup_page link for this season is revoked first, so
// the newest URL is always the live one, then a fresh raw URL is shown once via
// ?share=. When there is no active season there is nothing to scope a link to.
export async function regenerateSignupShareLink(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  await requireRole(programId, SHARE_LINK_ROLES);
  if (!seasonId) redirect(`${shiftsPath(slug)}?error=season`);

  const supabase = await createClient();
  await revokeShareLinksForResource(supabase, {
    programId,
    resource: "signup_page",
    resourceId: seasonId,
  });
  const minted = await mintShareLink(supabase, {
    programId,
    resource: "signup_page",
    resourceId: seasonId,
  });
  const share = "raw" in minted ? minted.raw : "";

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}${share ? `?share=${encodeURIComponent(share)}` : ""}`);
}

// Confirm a batch of suggested shifts (from the "Suggest shifts" flow). Each
// suggestion the director kept comes back as an indexed set of hidden fields;
// only rows flagged keep=on are created. Nothing here is auto-created — this runs
// on the director's explicit confirm (Constitution IV spirit).
export async function createSuggestedShifts(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  const competitionId = str(formData, "competitionId");
  const tz = str(formData, "tz");
  await requireRole(programId, SHIFT_WRITE_ROLES);
  if (!seasonId) redirect(`${shiftsPath(slug)}?error=season`);

  const count = Number(str(formData, "count")) || 0;
  const supabase = await createClient();

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    if (str(formData, `keep_${i}`) !== "on") continue;
    const title = str(formData, `title_${i}`);
    if (!title) continue;
    const neededRaw = Number(str(formData, `needed_${i}`));
    const needed =
      Number.isFinite(neededRaw) && neededRaw > 0 ? Math.floor(neededRaw) : 1;
    rows.push({
      program_id: programId,
      season_id: seasonId,
      competition_id: competitionId || null,
      title,
      starts_at: wallToIso(formData, `starts_${i}`, tz),
      ends_at: wallToIso(formData, `ends_${i}`, tz),
      needed_count: needed,
      notes: str(formData, `notes_${i}`) || null,
    });
  }

  if (rows.length > 0) {
    await supabase.from("shifts").insert(rows);
  }

  revalidatePath(shiftsPath(slug));
  redirect(`${shiftsPath(slug)}?created=${rows.length}`);
}
