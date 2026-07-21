"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  TRAVEL_WRITE_ROLES,
  TRAVEL_GROUP_KINDS,
  isAlreadyPlacedError,
  type TravelGroupKind,
} from "@/lib/travel";

// Travel CRUD + assignment (§6, T016). Writes are director/admin ("Travel
// rosters" write in §2); every action re-checks the role via requireRole
// (Constitution I) even though RLS also gates it. The one-room-one-bus trigger
// is the real backstop for double-placement — assignStudent catches its
// unique_violation and bounces to a friendly message.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function nullable(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v || null;
}
function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ---- Trips -----------------------------------------------------------------

export async function createTrip(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/travel?error=name`);
  if (!seasonId) redirect(`/${slug}/travel?error=season`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .insert({
      program_id: programId,
      season_id: seasonId,
      competition_id: nullable(formData, "competition_id"),
      name,
      starts_on: nullable(formData, "starts_on"),
      ends_on: nullable(formData, "ends_on"),
      is_overnight: str(formData, "is_overnight") === "on",
    })
    .select("id")
    .single();

  if (error || !data) redirect(`/${slug}/travel?error=save`);

  revalidatePath(`/${slug}/travel`);
  redirect(`/${slug}/travel/${data.id}`);
}

export async function updateTrip(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/travel/${tripId}?error=name`);

  const startsOn = nullable(formData, "starts_on");
  const endsOn = nullable(formData, "ends_on");
  // Date sanity: a trip can't end before it starts. createTrip predates this
  // guard; it lives here where an editor can flip the two dates by hand.
  if (startsOn && endsOn && endsOn < startsOn) {
    redirect(`/${slug}/travel/${tripId}?error=dates`);
  }

  const isOvernight = str(formData, "is_overnight") === "on";

  const supabase = await createClient();

  // Room-safety: rooms are only meaningful on an overnight trip. Turning
  // overnight OFF while rooms exist would strand them (they'd stop rendering but
  // keep their rider assignments), so reject and tell the director to clear the
  // rooms first rather than silently orphaning them.
  if (!isOvernight) {
    const { count: roomCount } = await supabase
      .from("travel_groups")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId)
      .eq("trip_id", tripId)
      .eq("kind", "room");
    if ((roomCount ?? 0) > 0) {
      redirect(`/${slug}/travel/${tripId}?error=overnight_rooms`);
    }
  }

  const { error } = await supabase
    .from("trips")
    .update({
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      is_overnight: isOvernight,
      competition_id: nullable(formData, "competition_id"),
    })
    .eq("id", tripId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/travel/${tripId}?error=save`);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

export async function deleteTrip(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  // Cascade manually: assignments + chaperones → groups → trip (no ON DELETE).
  const { data: groups } = await supabase
    .from("travel_groups")
    .select("id")
    .eq("program_id", programId)
    .eq("trip_id", tripId);
  const groupIds = ((groups as { id: string }[] | null) ?? []).map((g) => g.id);
  if (groupIds.length > 0) {
    await supabase.from("travel_assignments").delete().in("travel_group_id", groupIds);
    await supabase.from("travel_chaperones").delete().in("travel_group_id", groupIds);
    await supabase.from("travel_groups").delete().in("id", groupIds);
  }
  await supabase.from("trips").delete().eq("id", tripId).eq("program_id", programId);

  revalidatePath(`/${slug}/travel`);
  redirect(`/${slug}/travel`);
}

// ---- Groups (rooms / buses) ------------------------------------------------

export async function createGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const kind = str(formData, "kind") as TravelGroupKind;
  const label = str(formData, "label");
  if (!TRAVEL_GROUP_KINDS.includes(kind) || !label) {
    redirect(`/${slug}/travel/${tripId}?error=group`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("travel_groups").insert({
    program_id: programId,
    trip_id: tripId,
    kind,
    label,
    capacity: intOrNull(formData, "capacity"),
    notes: nullable(formData, "notes"),
    sort_order: intOrNull(formData, "sort_order") ?? 0,
  });
  if (error) redirect(`/${slug}/travel/${tripId}?error=group`);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

export async function updateGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "groupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const label = str(formData, "label");
  if (!label) redirect(`/${slug}/travel/${tripId}?error=group`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("travel_groups")
    .update({
      label,
      capacity: intOrNull(formData, "capacity"),
      notes: nullable(formData, "notes"),
      sort_order: intOrNull(formData, "sort_order") ?? 0,
    })
    .eq("id", groupId)
    .eq("program_id", programId);
  if (error) redirect(`/${slug}/travel/${tripId}?error=group`);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "groupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  await supabase.from("travel_assignments").delete().eq("travel_group_id", groupId);
  await supabase.from("travel_chaperones").delete().eq("travel_group_id", groupId);
  await supabase.from("travel_groups").delete().eq("id", groupId).eq("program_id", programId);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

// ---- Assignments -----------------------------------------------------------

export async function assignStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "travelGroupId");
  const studentId = str(formData, "studentId");
  const kind = str(formData, "kind");
  // H1 bulk-fill flow: when a fill target is active the chip submits carry the
  // group id in `fill`. Preserve it through every redirect so the page re-renders
  // with the sticky "Filling …" bar still up and the next chip a tap away — the
  // ?sel= precedent, threaded through success/conflict/error alike.
  const fill = str(formData, "fill");
  const fillQ = fill ? `fill=${fill}` : "";
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase.from("travel_assignments").insert({
    program_id: programId,
    travel_group_id: groupId,
    student_id: studentId,
  });

  if (isAlreadyPlacedError(error)) {
    // One-room-one-bus (or duplicate) — surface kindly with enough context for the
    // page to name the student and the group they're already in (§6).
    redirect(
      `/${slug}/travel/${tripId}?conflict=${studentId}&conflictKind=${kind}${
        fillQ ? `&${fillQ}` : ""
      }`,
    );
  }
  if (error) {
    redirect(
      `/${slug}/travel/${tripId}?error=assign&sel=${studentId}${
        fillQ ? `&${fillQ}` : ""
      }`,
    );
  }

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}${fillQ ? `?${fillQ}` : ""}`);
}

export async function unassignStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const assignmentId = str(formData, "assignmentId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("travel_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("program_id", programId);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

// ---- Chaperones ------------------------------------------------------------

export async function addChaperone(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "travelGroupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const guardianId = nullable(formData, "guardian_id");
  const nameOverride = nullable(formData, "name_override");
  if (!guardianId && !nameOverride) {
    redirect(`/${slug}/travel/${tripId}?error=chaperone`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("travel_chaperones").insert({
    program_id: programId,
    travel_group_id: groupId,
    // A guardian reference wins over free text when both are somehow supplied.
    guardian_id: guardianId,
    name_override: guardianId ? null : nameOverride,
  });
  if (error) redirect(`/${slug}/travel/${tripId}?error=chaperone`);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}

export async function removeChaperone(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const chaperoneId = str(formData, "chaperoneId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("travel_chaperones")
    .delete()
    .eq("id", chaperoneId)
    .eq("program_id", programId);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(`/${slug}/travel/${tripId}`);
}
