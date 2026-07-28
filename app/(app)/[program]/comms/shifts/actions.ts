"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type Role } from "@/lib/auth";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { zonedWallToUtc } from "@/lib/datetime";
import { programPath } from "@/lib/return-path";
import { mintShareLink, revokeShareLinksForResource } from "@/lib/tokens";
import {
  isRowShiftError,
  shiftAnchor,
  type ShiftErrorKey,
  type ShiftOkKey,
} from "./shared";

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

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce "//evil.com/comms/shifts", which every
// browser follows off-site. programPath validates the slug and fails closed.
function shiftsPath(slug: string): string {
  return programPath(slug, "comms/shifts") ?? "/";
}

// Where a message goes is the MAP's answer, not this file's (shared.ts). A
// failure that belongs to ONE shift goes back to that shift: `?edit=` names the
// row, and the page renders the message on the control that produced it —
// inside the Edit panel for an edit failure, next to the add-a-name form for a
// signup failure — instead of at the top of a list the writer then has to
// scroll to find their row again (the Wave-2 section-local error contract).
// With no shift id there is no row to return to, so it falls back to the
// page-level message.
function fail(slug: string, key: ShiftErrorKey, shiftId?: string): string {
  if (isRowShiftError(key) && shiftId) {
    const id = encodeURIComponent(shiftId);
    return `${shiftsPath(slug)}?edit=${id}&error=${key}#${shiftAnchor(id)}`;
  }
  return `${shiftsPath(slug)}?error=${key}`;
}

// The success half of the same contract: one `?ok=<key>` where five params used
// to each print their own toast.
function done(slug: string, key: ShiftOkKey): string {
  return `${shiftsPath(slug)}?ok=${key}`;
}

// Convert a datetime-local wall-clock value in the program tz to a UTC ISO
// string, or null when blank.
function wallToIso(fd: FormData, key: string, tz: string): string | null {
  const wall = str(fd, key);
  if (!wall) return null;
  return zonedWallToUtc(wall, tz)?.toISOString() ?? null;
}

// What a shift can be attached to, and the table each kind lives in.
const ATTACH_TABLES = {
  competition: "competitions",
  trip: "trips",
  event: "events",
} as const;
type AttachKind = keyof typeof ATTACH_TABLES;

// What the drawer's one attach-to select posts: "" for standalone, or a
// "<kind>:<id>" composite naming BOTH halves of the choice at once.
//
// It used to be two independent selects — a kind and a "which one" list that
// held every competition, trip and event together — so a director could pick
// "Trip" and then a competition. The help text said a mismatched pick was
// "ignored"; it was not. The create was refused and the drawer, with everything
// typed into it, was thrown away. One select cannot express the mismatch, so
// there is nothing left to explain or to refuse.
type AttachPick = { kind: AttachKind; id: string } | "standalone" | null;

// Own-property check, not `in` — `in` walks the prototype chain, so a posted
// kind of "constructor" or "toString" would otherwise read as a valid kind and
// hand a junk table name to the resolver.
function parseAttach(fd: FormData): AttachPick {
  const raw = str(fd, "attach");
  if (!raw) return "standalone";
  const split = raw.indexOf(":");
  if (split < 0) return null;
  const kind = raw.slice(0, split);
  const id = raw.slice(split + 1);
  if (!id || !Object.hasOwn(ATTACH_TABLES, kind)) return null;
  return { kind: kind as AttachKind, id };
}

// Spread the attach-to selection into exactly one of competition/trip/event (or
// all null). Takes an already-RESOLVED id — see resolveInProgram below.
function attachColumns(
  kind: AttachKind | null,
  id: string | null,
): { competition_id: string | null; trip_id: string | null; event_id: string | null } {
  return {
    competition_id: kind === "competition" ? id : null,
    trip_id: kind === "trip" ? id : null,
    event_id: kind === "event" ? id : null,
  };
}

type Db = Awaited<ReturnType<typeof createClient>>;

// Resolve a client-posted id inside this program, returning it only when the row
// really is this program's. Every id a shift points at (season, competition,
// trip, event) and every shift a signup points at arrives from a hidden form
// field, and the write policies check nothing but the new row's own program_id —
// so this is the only thing stopping a shift or signup from being stamped onto
// another program's records, where it is invisible to them, undeletable by them,
// and silently blocks them from deleting the event or trip it hangs off
// (Constitution I). Returns null for a blank id or a row outside the program.
async function resolveInProgram(
  supabase: Db,
  table: string,
  id: string,
  programId: string,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// The attach-to columns for a create, with the posted id resolved inside this
// program. "Nothing (standalone)" stays allowed; an id that isn't ours, or a
// composite that isn't one of ours to begin with, is refused.
async function resolvedAttachColumns(
  supabase: Db,
  formData: FormData,
  programId: string,
): Promise<ReturnType<typeof attachColumns> | null> {
  const picked = parseAttach(formData);
  if (picked === null) return null;
  if (picked === "standalone") return attachColumns(null, null);

  const resolved = await resolveInProgram(
    supabase,
    ATTACH_TABLES[picked.kind],
    picked.id,
    programId,
  );
  return resolved ? attachColumns(picked.kind, resolved) : null;
}

export async function createShift(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  const tz = str(formData, "tz");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const title = str(formData, "title");
  if (!title) redirect(fail(slug, "title"));
  if (!seasonId) redirect(fail(slug, "season"));

  const neededRaw = Number(str(formData, "needed_count"));
  const needed = Number.isFinite(neededRaw) && neededRaw > 0 ? Math.floor(neededRaw) : 1;

  const supabase = await createClient();

  if (!(await resolveInProgram(supabase, "seasons", seasonId, programId))) {
    redirect(fail(slug, "season"));
  }
  const attach = await resolvedAttachColumns(supabase, formData, programId);
  if (!attach) redirect(fail(slug, "attach"));

  const { error } = await supabase.from("shifts").insert({
    program_id: programId,
    season_id: seasonId,
    ...attach,
    title,
    starts_at: wallToIso(formData, "starts_at", tz),
    ends_at: wallToIso(formData, "ends_at", tz),
    needed_count: needed,
    notes: str(formData, "notes") || null,
  });
  if (error) redirect(fail(slug, "save"));

  revalidatePath(shiftsPath(slug));
  redirect(done(slug, "created"));
}

export async function updateShift(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const shiftId = str(formData, "shiftId");
  const tz = str(formData, "tz");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  const title = str(formData, "title");
  if (!title) redirect(fail(slug, "row_title", shiftId));
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
  redirect(done(slug, "saved"));
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
  const { error } = await supabase
    .from("shifts")
    .delete()
    .eq("id", shiftId)
    .eq("program_id", programId);

  revalidatePath(shiftsPath(slug));
  // The signup sweep above can only reach THIS program's rows, so a signup
  // belonging to another program leaves the shift referenced and the delete
  // fails. Say so, on the row that is still there — reporting "deleted" for a
  // shift that is still listed is the worst outcome, because staff stop looking.
  if (error) redirect(fail(slug, "in_use", shiftId));
  redirect(done(slug, "deleted"));
}

// Staff adds a signup on a parent's behalf (source 'staff_entered'). No
// guardian_id — this is a hand-entered name/email, not a token claim.
export async function addStaffSignup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const shiftId = str(formData, "shiftId");
  await requireRole(programId, SHIFT_WRITE_ROLES);

  // The add-a-name form lives ON a shift card, so its failures go back to that
  // card — not to the top of a page of cards, where the message is nowhere near
  // the box the name was typed into and the typing is gone besides.
  const name = str(formData, "name");
  if (!name) redirect(fail(slug, "name", shiftId));

  const supabase = await createClient();

  // Resolve the shift inside this program before writing a name to it: a signup
  // is free text that renders into the parent packet PDF, so a signup on another
  // program's shift would put text of our choosing in front of THEIR families.
  const resolvedShiftId = await resolveInProgram(
    supabase,
    "shifts",
    shiftId,
    programId,
  );
  if (!resolvedShiftId) redirect(fail(slug, "shift", shiftId));

  await supabase.from("shift_signups").insert({
    program_id: programId,
    shift_id: resolvedShiftId,
    guardian_id: null,
    name,
    email: str(formData, "email") || null,
    status: "confirmed",
    source: "staff_entered",
  });

  revalidatePath(shiftsPath(slug));
  redirect(done(slug, "signed"));
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
  redirect(done(slug, "cancelled"));
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
  if (!seasonId) redirect(fail(slug, "season"));

  const supabase = await createClient();
  await revokeShareLinksForResource(supabase, {
    programId,
    resource: "signup_page",
    resourceId: seasonId,
  });
  // mintShareLink resolves seasonId inside this program, so a tampered season id
  // mints nothing. The revoke above already ran, so a failure here would leave
  // the program with no live link — say so instead of redirecting silently.
  const minted = await mintShareLink(supabase, {
    programId,
    resource: "signup_page",
    resourceId: seasonId,
  });

  revalidatePath(shiftsPath(slug));
  if (!("raw" in minted)) redirect(fail(slug, "share"));
  redirect(`${shiftsPath(slug)}?share=${encodeURIComponent(minted.raw)}`);
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
  if (!seasonId) redirect(fail(slug, "season"));

  const count = Number(str(formData, "count")) || 0;
  const supabase = await createClient();

  // Same resolution as createShift — the season and the competition these
  // suggestions hang off both arrive as hidden fields.
  if (!(await resolveInProgram(supabase, "seasons", seasonId, programId))) {
    redirect(fail(slug, "season"));
  }
  const attachedCompetitionId = competitionId
    ? await resolveInProgram(supabase, "competitions", competitionId, programId)
    : null;
  if (competitionId && !attachedCompetitionId) {
    redirect(fail(slug, "attach"));
  }

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
      competition_id: attachedCompetitionId,
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
  redirect(done(slug, "suggested"));
}
