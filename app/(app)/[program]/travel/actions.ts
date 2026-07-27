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
import { returnPath, programPath } from "@/lib/return-path";

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

// Where a create/edit launched from the Season page goes back to. `from` is an
// opaque allow-listed key resolved server-side (lib/return-path) — never a
// client-supplied URL. Absent/unknown ⇒ null ⇒ today's redirects, unchanged.
function seasonReturn(fd: FormData, slug: string): string | null {
  return returnPath(slug, str(fd, "from"));
}

// Fail closed on the slug: it arrives as a form field, and a value like
// "/evil.com" interpolated into a path makes a protocol-relative URL the browser
// happily follows off-site (lib/return-path). Anything that isn't a program slug
// lands on "/" rather than building a target out of it.
function travelPath(slug: string): string {
  return programPath(slug, "travel") ?? "/";
}
function tripPath(slug: string, tripId: string): string {
  return programPath(slug, `travel/${tripId}`) ?? "/";
}

// Which of the two group sections an error belongs to (spec 005 US6-3): the
// trip page renders each message inside the section that owns what failed, so
// the redirect has to say which. Validated here — the page reads it straight
// into a label lookup.
function kindQuery(kind: string): string {
  return TRAVEL_GROUP_KINDS.includes(kind as TravelGroupKind)
    ? `&errorKind=${kind}`
    : "";
}

// ---- Trips -----------------------------------------------------------------

export async function createTrip(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  // Quick-add from the Season page comes back to Season with the drawer's trip
  // section reopened on the same error message it always used.
  const back = seasonReturn(formData, slug);
  const fail = (code: string): string =>
    back ? `${back}?error=${code}&add=trip` : `${travelPath(slug)}?error=${code}`;

  const competitionId = nullable(formData, "competition_id");
  let name = str(formData, "name");
  let startsOn = nullable(formData, "starts_on");
  let endsOn = nullable(formData, "ends_on");

  const supabase = await createClient();

  // A trip FOR a competition takes its name and date from that competition when
  // the form didn't supply them. One server-side code path serves both the
  // Season quick-add (which asks for neither) and the travel page's per-comp
  // suggestion rows (which used to carry the same values as hidden inputs).
  if (competitionId && (!name || !startsOn)) {
    const { data: compData } = await supabase
      .from("competitions")
      .select("name, date")
      .eq("id", competitionId)
      .eq("program_id", programId)
      .maybeSingle();
    const comp = compData as { name: string; date: string | null } | null;
    if (comp) {
      if (!name) name = `${comp.name} — travel`;
      if (!startsOn) {
        startsOn = comp.date;
        if (!endsOn) endsOn = comp.date;
      }
    }
  }

  if (!name) redirect(fail("name"));
  if (!seasonId) redirect(fail("season"));

  const { data, error } = await supabase
    .from("trips")
    .insert({
      program_id: programId,
      season_id: seasonId,
      competition_id: competitionId,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      is_overnight: str(formData, "is_overnight") === "on",
    })
    .select("id")
    .single();

  if (error || !data) redirect(fail("save"));

  revalidatePath(`/${slug}/travel`);
  if (back) {
    revalidatePath(back);
    // The fragment scrolls the new row into view; ?created= is what actually
    // highlights it, and still does the whole job on its own.
    redirect(`${back}?created=trip-${data.id}#item-trip-${data.id}`);
  }
  redirect(tripPath(slug, data.id));
}

export async function updateTrip(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  // Spine edit popover (Season page): failures reopen that row's popover, saves
  // land back on the spine. Allow-listed server-side; trip-page edits come back
  // to the trip page, where Overview renders the message.
  const self = tripPath(slug, tripId);
  const back = seasonReturn(formData, slug);
  const fail = (code: string): string =>
    back ? `${back}?error=${code}&edit=trip-${tripId}` : `${self}?error=${code}`;

  const name = str(formData, "name");
  if (!name) redirect(fail("name"));

  const startsOn = nullable(formData, "starts_on");
  const endsOn = nullable(formData, "ends_on");
  // Date sanity: a trip can't end before it starts. createTrip predates this
  // guard; it lives here where an editor can flip the two dates by hand.
  if (startsOn && endsOn && endsOn < startsOn) {
    redirect(fail("dates"));
  }

  // Both popovers show this checkbox, so both read it. (A checkbox can't use the
  // "was it sent?" test the competition link uses below: an unticked box sends
  // nothing, and unticking it is precisely the case the room guard exists for.)
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
      redirect(fail("overnight_rooms"));
    }
  }

  // Both callers are sparse popovers (`sparse=1`): each posts only the fields it
  // shows, and everything else is left alone. The competition link is the one
  // field they differ on — the Season spine's popover doesn't show it, and
  // reading that silence as "unlink" is how a date fix used to cut a trip loose
  // from its competition. The trip page's Overview popover does show it, so its
  // value is written, including the empty "— none" that deliberately unlinks.
  const fields: Record<string, unknown> = {
    name,
    starts_on: startsOn,
    ends_on: endsOn,
    is_overnight: isOvernight,
  };
  if (formData.has("competition_id")) {
    fields.competition_id = nullable(formData, "competition_id");
  }

  const { error } = await supabase
    .from("trips")
    .update(fields)
    .eq("id", tripId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));

  revalidatePath(`/${slug}/travel/${tripId}`);
  if (back) {
    revalidatePath(back);
    redirect(`${back}?saved=trip-${tripId}#item-trip-${tripId}`);
  }
  redirect(self);
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
  redirect(travelPath(slug));
}

// ---- Groups (rooms / buses) ------------------------------------------------

export async function createGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const self = tripPath(slug, tripId);
  const kind = str(formData, "kind") as TravelGroupKind;
  const label = str(formData, "label");
  const failGroup = `${self}?error=group${kindQuery(kind)}`;
  if (!TRAVEL_GROUP_KINDS.includes(kind) || !label) {
    redirect(failGroup);
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
  if (error) redirect(failGroup);

  revalidatePath(`/${slug}/travel/${tripId}`);
  // Land back on the section that was just added to (…#rooms / …#buses) rather
  // than scrolled to the top — a director adding several groups stays in place.
  const anchor = kind === "room" ? "rooms" : "buses";
  redirect(`${self}#${anchor}`);
}

export async function updateGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "groupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const self = tripPath(slug, tripId);
  const label = str(formData, "label");
  // The edit form carries its card's kind so a failure comes back into the Buses
  // or Rooms section it happened in, not both.
  const failGroup = `${self}?error=group${kindQuery(str(formData, "kind"))}`;
  if (!label) redirect(failGroup);

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
  if (error) redirect(failGroup);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(self);
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
  redirect(tripPath(slug, tripId));
}

// ---- Assignments -----------------------------------------------------------

export async function assignStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "travelGroupId");
  const studentId = str(formData, "studentId");
  const kind = str(formData, "kind");
  // The fill flow is the only way here (spec 005 US5): the chip submits carry
  // their target group id in `fill`. Preserve it through every redirect so the
  // page re-renders with the sticky "Filling …" bar still up and the next chip a
  // tap away — success, conflict, and error alike.
  const self = tripPath(slug, tripId);
  const fill = str(formData, "fill");
  const fillQ = fill ? `&fill=${fill}` : "";
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase.from("travel_assignments").insert({
    program_id: programId,
    travel_group_id: groupId,
    student_id: studentId,
  });

  if (isAlreadyPlacedError(error)) {
    // One-room-one-bus (or duplicate) — surface kindly with enough context for the
    // page to name the student and the group they're already in (§6), inside the
    // section for that kind.
    redirect(
      `${self}?conflict=${studentId}&conflictKind=${kind}${fillQ}`,
    );
  }
  if (error) {
    redirect(`${self}?error=assign${kindQuery(kind)}${fillQ}`);
  }

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(fill ? `${self}?fill=${fill}` : self);
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
  redirect(tripPath(slug, tripId));
}

// ---- Chaperones ------------------------------------------------------------

export async function addChaperone(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "travelGroupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const self = tripPath(slug, tripId);
  const guardianId = nullable(formData, "guardian_id");
  const nameOverride = nullable(formData, "name_override");
  if (!guardianId && !nameOverride) {
    redirect(`${self}?error=chaperone`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("travel_chaperones").insert({
    program_id: programId,
    travel_group_id: groupId,
    // A guardian reference wins over free text when both are somehow supplied.
    guardian_id: guardianId,
    name_override: guardianId ? null : nameOverride,
  });
  if (error) redirect(`${self}?error=chaperone`);

  revalidatePath(`/${slug}/travel/${tripId}`);
  redirect(self);
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
  redirect(tripPath(slug, tripId));
}
