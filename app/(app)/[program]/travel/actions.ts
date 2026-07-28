"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  TRAVEL_WRITE_ROLES,
  TRAVEL_GROUP_KINDS,
  isAlreadyPlacedError,
  type TravelGroupKind,
} from "@/lib/travel";
import { competitionEnsembleIds } from "@/lib/competitions";
import { returnPath, programPath } from "@/lib/return-path";
import { kindQuery } from "./[tripId]/shared";

// Travel CRUD + assignment (§6, T016). Writes are director/admin ("Travel
// rosters" write in §2); every action re-checks the role via requireRole
// (Constitution I) even though RLS also gates it. The one-room-one-bus trigger
// is the real backstop for double-placement — assignStudent catches its
// unique_violation and bounces to a friendly message.
//
// CROSS-PROGRAM REFERENCES (Constitution I, tenant isolation). Every id below
// arrives as a form field, and requireRole only proves the caller runs THIS
// program — not that the season/competition/trip/group/guardian/student they
// posted belongs to it. Anyone can self-serve a program at /launch and become
// its director, so an unresolved id lets them stamp their own program_id on a
// row that points into someone else's data: invisible to that program (reads
// filter program_id), undeletable by them (writes key on the attacker's
// program_id), and — through the service-role PDF/export readers — printable on
// their parent-facing paperwork. So: resolve first, scoped to programId (and
// the natural parent, e.g. trip_id), and fail closed to this surface's error
// convention when the row isn't there. Never write a client-posted denormalized
// value (a posted `kind`) — read it off the resolved row.
//
// Deletes are checked, not fired and forgotten: a foreign row that this program
// cannot see still blocks the FK, and an unchecked delete used to redirect as
// if it had succeeded while the trip was still sitting there.

// A one-off helper's name is free text that reaches a parent-facing PDF, so it
// is bounded here as well as in the database.
const NAME_OVERRIDE_MAX = 120;

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

// The fill target rides through every redirect so the queue stays up. It is a
// group id, but it is echoed into a URL, so it is encoded rather than pasted:
// a value carrying `&` or `#` would otherwise forge the params beside it.
function fillQuery(fill: string): string {
  return fill ? `&fill=${encodeURIComponent(fill)}` : "";
}

// ---- Cross-program resolvers -----------------------------------------------

interface ResolvedTrip {
  id: string;
  season_id: string;
  competition_id: string | null;
  is_overnight: boolean;
}

async function resolveTrip(
  supabase: SupabaseClient,
  programId: string,
  tripId: string,
): Promise<ResolvedTrip | null> {
  if (!tripId) return null;
  const { data } = await supabase
    .from("trips")
    .select("id, season_id, competition_id, is_overnight")
    .eq("id", tripId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as ResolvedTrip | null) ?? null;
}

// A group, proven to be on THIS trip in THIS program. `kind` comes back off the
// row so no caller has to trust the copy the form posted.
async function resolveGroup(
  supabase: SupabaseClient,
  programId: string,
  tripId: string,
  groupId: string,
): Promise<{ id: string; kind: TravelGroupKind } | null> {
  if (!groupId || !tripId) return null;
  const { data } = await supabase
    .from("travel_groups")
    .select("id, kind")
    .eq("id", groupId)
    .eq("program_id", programId)
    .eq("trip_id", tripId)
    .maybeSingle();
  return (data as { id: string; kind: TravelGroupKind } | null) ?? null;
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

  // The season the trip hangs off is posted by the form: resolve it here, or a
  // trip lands in this program pointing at another program's season — which then
  // controls its write-freeze and blocks that program's season cleanup forever.
  if (!seasonId) redirect(fail("season"));
  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("id")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  if (!seasonRow) redirect(fail("season"));

  // A trip FOR a competition takes its name and date from that competition when
  // the form didn't supply them. One server-side code path serves both the
  // Season quick-add (which asks for neither) and the travel page's per-comp
  // suggestion rows (which used to carry the same values as hidden inputs).
  // The lookup runs for EVERY create, not just the fallback: it is also what
  // proves the competition is this program's before the id is written.
  if (competitionId) {
    const { data: compData } = await supabase
      .from("competitions")
      .select("name, date")
      .eq("id", competitionId)
      .eq("program_id", programId)
      .maybeSingle();
    const comp = compData as { name: string; date: string | null } | null;
    if (!comp) redirect(fail("competition"));
    if (!name) name = `${comp.name} — travel`;
    if (!startsOn) {
      startsOn = comp.date;
      if (!endsOn) endsOn = comp.date;
    }
  }

  if (!name) redirect(fail("name"));
  // Date sanity, the same guard updateTrip applies: a trip can't end before it
  // starts, whichever form typed the two dates.
  if (startsOn && endsOn && endsOn < startsOn) redirect(fail("dates"));

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

  revalidatePath(travelPath(slug));
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
  // Date sanity: a trip can't end before it starts.
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

  // Two popovers post two different field sets, and the competition link is the
  // one they differ on. The Season spine's popover doesn't show it and doesn't
  // post it — reading that silence as "unlink" is how a date fix used to cut a
  // trip loose from its competition — so competition_id is written ONLY when the
  // field was actually sent. The trip page's Overview popover does show it, so
  // its value is written, including the empty "— none" that deliberately
  // unlinks. Everything else here is shown by both popovers and always written.
  const fields: Record<string, unknown> = {
    name,
    starts_on: startsOn,
    ends_on: endsOn,
    is_overnight: isOvernight,
  };
  if (formData.has("competition_id")) {
    const linkId = nullable(formData, "competition_id");
    if (linkId) {
      const { data: compRow } = await supabase
        .from("competitions")
        .select("id")
        .eq("id", linkId)
        .eq("program_id", programId)
        .maybeSingle();
      if (!compRow) redirect(fail("competition"));
    }
    fields.competition_id = linkId;
  }

  const { error } = await supabase
    .from("trips")
    .update(fields)
    .eq("id", tripId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));

  revalidatePath(tripPath(slug, tripId));
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
  // Each child delete is scoped by program_id AND its error is checked. A row
  // belonging to another program can point at these groups without this program
  // ever seeing it; it survives the delete, blocks the parent's FK, and the old
  // unchecked version then redirected to the trips list as though the trip were
  // gone while it was still there. Now the director gets told.
  const fail = `${tripPath(slug, tripId)}?error=trip_delete`;
  const { data: groups } = await supabase
    .from("travel_groups")
    .select("id")
    .eq("program_id", programId)
    .eq("trip_id", tripId);
  const groupIds = ((groups as { id: string }[] | null) ?? []).map((g) => g.id);
  if (groupIds.length > 0) {
    const { error: assignErr } = await supabase
      .from("travel_assignments")
      .delete()
      .eq("program_id", programId)
      .in("travel_group_id", groupIds);
    if (assignErr) redirect(fail);

    const { error: chapErr } = await supabase
      .from("travel_chaperones")
      .delete()
      .eq("program_id", programId)
      .in("travel_group_id", groupIds);
    if (chapErr) redirect(fail);

    const { error: groupErr } = await supabase
      .from("travel_groups")
      .delete()
      .eq("program_id", programId)
      .in("id", groupIds);
    if (groupErr) redirect(fail);
  }
  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("id", tripId)
    .eq("program_id", programId);
  if (error) redirect(fail);

  revalidatePath(travelPath(slug));
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
  // `kind` is genuinely this form's to choose, but the TRIP is a posted id:
  // resolve it before hanging a group off it, or the group lands in this program
  // pointing at another program's trip — where it renders for nobody and makes
  // that trip permanently undeletable.
  const trip = await resolveTrip(supabase, programId, tripId);
  if (!trip) redirect(failGroup);

  // Rooms only mean something on an overnight trip — the same invariant
  // updateTrip defends from the other side when overnight is switched off.
  if (kind === "room" && !trip.is_overnight) {
    redirect(`${self}?error=room_daytrip${kindQuery(kind)}`);
  }

  const { error } = await supabase.from("travel_groups").insert({
    program_id: programId,
    trip_id: trip.id,
    kind,
    label,
    capacity: intOrNull(formData, "capacity"),
    notes: nullable(formData, "notes"),
    sort_order: intOrNull(formData, "sort_order") ?? 0,
  });
  if (error) redirect(failGroup);

  revalidatePath(tripPath(slug, tripId));
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

  const supabase = await createClient();
  // Resolving the card first does two jobs: it pins the edit to a group on THIS
  // trip in this program, and it hands back the kind — so a failure comes back
  // into the Buses or Rooms section it happened in without the form having to
  // post (and this action having to trust) a copy of it.
  const group = await resolveGroup(supabase, programId, tripId, groupId);
  if (!group) redirect(`${self}?error=group_missing`);

  const failGroup = `${self}?error=group${kindQuery(group.kind)}`;
  if (!label) redirect(failGroup);

  const { error } = await supabase
    .from("travel_groups")
    .update({
      label,
      capacity: intOrNull(formData, "capacity"),
      notes: nullable(formData, "notes"),
      sort_order: intOrNull(formData, "sort_order") ?? 0,
    })
    .eq("id", group.id)
    .eq("program_id", programId);
  if (error) redirect(failGroup);

  revalidatePath(tripPath(slug, tripId));
  redirect(self);
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "groupId");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const self = tripPath(slug, tripId);
  const supabase = await createClient();
  const group = await resolveGroup(supabase, programId, tripId, groupId);
  if (!group) redirect(`${self}?error=group_missing`);

  // Same story as deleteTrip: scope the children by program_id and check every
  // step. A rider or chaperone row belonging to another program survives this
  // delete and blocks the group's FK; unchecked, the page came back looking as
  // if the bus had gone.
  const failGroup = `${self}?error=group_delete${kindQuery(group.kind)}`;
  const { error: assignErr } = await supabase
    .from("travel_assignments")
    .delete()
    .eq("program_id", programId)
    .eq("travel_group_id", group.id);
  if (assignErr) redirect(failGroup);

  const { error: chapErr } = await supabase
    .from("travel_chaperones")
    .delete()
    .eq("program_id", programId)
    .eq("travel_group_id", group.id);
  if (chapErr) redirect(failGroup);

  const { error } = await supabase
    .from("travel_groups")
    .delete()
    .eq("id", group.id)
    .eq("program_id", programId);
  if (error) redirect(failGroup);

  revalidatePath(tripPath(slug, tripId));
  redirect(self);
}

// ---- Assignments -----------------------------------------------------------

export async function assignStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const groupId = str(formData, "travelGroupId");
  const studentId = str(formData, "studentId");
  // The fill flow is the only way here (spec 005 US5): the chip submits carry
  // their target group id in `fill`. Preserve it through every redirect so the
  // page re-renders with the sticky "Filling …" bar still up and the next chip a
  // tap away — success, conflict, and error alike.
  const self = tripPath(slug, tripId);
  const fill = str(formData, "fill");
  const fillQ = fillQuery(fill);
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();

  // The group is a posted id, and its `kind` used to be posted alongside it.
  // Both come off the resolved row now: the group has to be on this trip in this
  // program, and the kind that routes the error message is the stored one. The
  // trip comes back alongside it — in parallel, because this runs once per tap
  // in the fill queue and every round trip is felt.
  const [group, trip] = await Promise.all([
    resolveGroup(supabase, programId, tripId, groupId),
    resolveTrip(supabase, programId, tripId),
  ]);
  if (!group) redirect(`${self}?error=group_missing${fillQ}`);
  if (!trip || !studentId) redirect(`${self}?error=assign${fillQ}`);

  // Eligibility was a UI-level constraint — the queue only rendered chips for
  // students who belong here — which means it was no constraint at all against a
  // posted id. Re-derive it from the same read the page draws the queue from:
  // an ensemble member of the trip's season, narrowed to the linked
  // competition's participating ensembles when there is one (Feature 004).
  let eligibleQuery = supabase
    .from("ensemble_members")
    .select("student_id")
    .eq("program_id", programId)
    .eq("season_id", trip.season_id)
    .eq("student_id", studentId);
  if (trip.competition_id) {
    const compEnsembleIds = await competitionEnsembleIds(
      supabase,
      trip.competition_id,
    );
    if (compEnsembleIds.length > 0) {
      eligibleQuery = eligibleQuery.in("ensemble_id", compEnsembleIds);
    }
  }
  const { data: memberRows } = await eligibleQuery.limit(1);
  if (((memberRows as unknown[] | null) ?? []).length === 0) {
    redirect(`${self}?error=student${kindQuery(group.kind)}${fillQ}`);
  }

  const { error } = await supabase.from("travel_assignments").insert({
    program_id: programId,
    travel_group_id: group.id,
    student_id: studentId,
  });

  if (isAlreadyPlacedError(error)) {
    // One-room-one-bus (or duplicate) — surface kindly with enough context for the
    // page to name the student and the group they're already in (§6), inside the
    // section for that kind.
    redirect(
      `${self}?conflict=${studentId}&conflictKind=${group.kind}${fillQ}`,
    );
  }
  if (error) {
    redirect(`${self}?error=assign${kindQuery(group.kind)}${fillQ}`);
  }

  revalidatePath(tripPath(slug, tripId));
  redirect(fill ? `${self}?fill=${encodeURIComponent(fill)}` : self);
}

export async function unassignStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const tripId = str(formData, "tripId");
  const assignmentId = str(formData, "assignmentId");
  // Taking someone off mid-fill keeps the fill target: the remove buttons post
  // the active `fill` group so the queue and its sticky bar are still up when
  // the page comes back, instead of dumping the director out of the flow.
  const fill = str(formData, "fill");
  await requireRole(programId, TRAVEL_WRITE_ROLES);

  const supabase = await createClient();
  await supabase
    .from("travel_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("program_id", programId);

  revalidatePath(tripPath(slug, tripId));
  const self = tripPath(slug, tripId);
  redirect(fill ? `${self}?fill=${encodeURIComponent(fill)}` : self);
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
  if (nameOverride && nameOverride.length > NAME_OVERRIDE_MAX) {
    redirect(`${self}?error=chaperone_name`);
  }

  const supabase = await createClient();
  const group = await resolveGroup(supabase, programId, tripId, groupId);
  if (!group) redirect(`${self}?error=chaperone_group`);

  // The picker only ever offers this program's guardians, but the option set is
  // a UI constraint: re-derive it. Without this, a posted id prints another
  // program's parent's name on this trip's paperwork (the packet render resolves
  // the guardian name under a service-role client).
  if (guardianId) {
    const { data: guardianRow } = await supabase
      .from("guardians")
      .select("id")
      .eq("id", guardianId)
      .eq("program_id", programId)
      .maybeSingle();
    if (!guardianRow) redirect(`${self}?error=chaperone_guardian`);
  }

  const { error } = await supabase.from("travel_chaperones").insert({
    program_id: programId,
    travel_group_id: group.id,
    // A guardian reference wins over free text when both are somehow supplied.
    guardian_id: guardianId,
    name_override: guardianId ? null : nameOverride,
  });
  if (error) redirect(`${self}?error=chaperone`);

  revalidatePath(tripPath(slug, tripId));
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

  revalidatePath(tripPath(slug, tripId));
  redirect(tripPath(slug, tripId));
}
