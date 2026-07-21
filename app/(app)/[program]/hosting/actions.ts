"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { zonedWallToUtc } from "@/lib/datetime";
import {
  HOSTING_WRITE_ROLES,
  HOSTED_EVENT_STATUSES,
  HOSTED_SLOT_KINDS,
  DEFAULT_WARMUP_MINUTES,
  DEFAULT_PERFORM_MINUTES,
  generateHostSchedule,
  computeShiftRemaining,
  type HostedEventStatus,
  type HostedSlotKind,
} from "@/lib/hosting";

// Host-mode server actions (Wave I2). Writes are director/admin (HOSTING_WRITE_
// ROLES); every action re-checks the role via requireRole (Constitution I) even
// though RLS also gates it. Season-archived events are frozen at the RLS layer;
// we pre-check here to surface a friendly ?error=archived instead of a raw
// failure (mirrors the ArchivedBanner posture on season-scoped surfaces).

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

// Resolve an event to its program + season + archived flag, scoped to programId.
// Returns null when the event is missing/hidden (RLS) — the caller bounces.
async function loadEventGuard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  eventId: string,
): Promise<{ seasonId: string; archived: boolean } | null> {
  const { data } = await supabase
    .from("hosted_events")
    .select("season_id, seasons(archived_at)")
    .eq("id", eventId)
    .eq("program_id", programId)
    .maybeSingle();
  const row = data as
    | { season_id: string; seasons: { archived_at: string | null } | null }
    | null;
  if (!row) return null;
  return { seasonId: row.season_id, archived: row.seasons?.archived_at != null };
}

// ---- Events ----------------------------------------------------------------

// Create a hosted invitational in the active season. Name required; date is
// optional (a planning-stage event may not have a date yet). Starts 'planning'.
export async function createHostedEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/hosting?error=name`);
  if (!seasonId) redirect(`/${slug}/hosting?error=season`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hosted_events")
    .insert({
      program_id: programId,
      season_id: seasonId,
      name,
      event_date: nullable(formData, "event_date"),
      status: "planning",
    })
    .select("id")
    .single();

  if (error || !data) redirect(`/${slug}/hosting?error=save`);

  revalidatePath(`/${slug}/hosting`);
  redirect(`/${slug}/hosting/${(data as { id: string }).id}?created=1`);
}

// Header inline edit: name / date / status.
export async function updateHostedEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const name = str(formData, "name");
  if (!name) redirect(`/${slug}/hosting/${eventId}?error=name`);
  const status = str(formData, "status") as HostedEventStatus;

  const { error } = await supabase
    .from("hosted_events")
    .update({
      name,
      event_date: nullable(formData, "event_date"),
      venue_notes: nullable(formData, "venue_notes"),
      host_contact: nullable(formData, "host_contact"),
      status: HOSTED_EVENT_STATUSES.includes(status) ? status : "planning",
    })
    .eq("id", eventId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?saved=1`);
}

// ---- Schools ---------------------------------------------------------------

function schoolFields(formData: FormData) {
  return {
    school_name: str(formData, "school_name"),
    ensemble_name: nullable(formData, "ensemble_name"),
    director_name: nullable(formData, "director_name"),
    director_email: nullable(formData, "director_email"),
    director_phone: nullable(formData, "director_phone"),
    performer_count: intOrNull(formData, "performer_count"),
    division: nullable(formData, "division"),
    costume_colors: nullable(formData, "costume_colors"),
    homeroom: nullable(formData, "homeroom"),
    arrival_notes: nullable(formData, "arrival_notes"),
  };
}

export async function addHostedSchool(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const fields = schoolFields(formData);
  if (!fields.school_name) {
    redirect(`/${slug}/hosting/${eventId}?error=school_name#schools`);
  }

  // Append to the end of the current sort order.
  const { data: last } = await supabase
    .from("hosted_schools")
    .select("sort_order")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("hosted_schools").insert({
    program_id: programId,
    hosted_event_id: eventId,
    ...fields,
    sort_order: nextSort,
  });

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schools`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?school_saved=1#schools`);
}

export async function updateHostedSchool(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const schoolId = str(formData, "schoolId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const fields = schoolFields(formData);
  if (!fields.school_name) {
    redirect(`/${slug}/hosting/${eventId}?error=school_name#schools`);
  }
  const sortOrder = intOrNull(formData, "sort_order");

  const { error } = await supabase
    .from("hosted_schools")
    .update({
      ...fields,
      ...(sortOrder != null ? { sort_order: sortOrder } : {}),
    })
    .eq("id", schoolId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schools`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?school_saved=1#schools`);
}

export async function removeHostedSchool(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const schoolId = str(formData, "schoolId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  // Detach any slots pointing at this school (they become label-only rows)
  // before deleting, so a school removal never orphans a schedule row's FK.
  await supabase
    .from("hosted_slots")
    .update({ hosted_school_id: null })
    .eq("program_id", programId)
    .eq("hosted_school_id", schoolId);

  const { error } = await supabase
    .from("hosted_schools")
    .delete()
    .eq("id", schoolId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schools`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?school_removed=1#schools`);
}

// ---- Slots -----------------------------------------------------------------

export async function addHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const kind = str(formData, "kind") as HostedSlotKind;
  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at"); // datetime-local, program tz
  const startsAt = startWall ? zonedWallToUtc(startWall, tz)?.toISOString() ?? null : null;

  const { data: last } = await supabase
    .from("hosted_slots")
    .select("sort_order")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("hosted_slots").insert({
    program_id: programId,
    hosted_event_id: eventId,
    hosted_school_id: nullable(formData, "hosted_school_id"),
    kind: HOSTED_SLOT_KINDS.includes(kind) ? kind : "other",
    label: nullable(formData, "label"),
    starts_at: startsAt,
    duration_minutes: intOrNull(formData, "duration_minutes"),
    sort_order: nextSort,
  });

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schedule`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?slot_saved=1#schedule`);
}

export async function updateHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const slotId = str(formData, "slotId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const kind = str(formData, "kind") as HostedSlotKind;
  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at");
  const startsAt = startWall ? zonedWallToUtc(startWall, tz)?.toISOString() ?? null : null;

  const { error } = await supabase
    .from("hosted_slots")
    .update({
      hosted_school_id: nullable(formData, "hosted_school_id"),
      kind: HOSTED_SLOT_KINDS.includes(kind) ? kind : "other",
      label: nullable(formData, "label"),
      starts_at: startsAt,
      duration_minutes: intOrNull(formData, "duration_minutes"),
    })
    .eq("id", slotId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schedule`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?slot_saved=1#schedule`);
}

export async function removeHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const slotId = str(formData, "slotId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const { error } = await supabase
    .from("hosted_slots")
    .delete()
    .eq("id", slotId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schedule`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?slot_removed=1#schedule`);
}

// "Generate schedule" — materialize the deterministic warm-up/perform ladder for
// every school in sort_order. Offered only when no slots exist; when the replace
// flag is set (confirm-box), the current schedule is cleared first. Pure ladder
// math lives in lib/hosting.generateHostSchedule.
export async function generateHostedSchedule(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at");
  const startInstant = startWall ? zonedWallToUtc(startWall, tz) : null;
  if (!startInstant) redirect(`/${slug}/hosting/${eventId}?error=start#schedule`);

  const warmupMinutes = intOrNull(formData, "warmup_minutes") ?? DEFAULT_WARMUP_MINUTES;
  const performMinutes = intOrNull(formData, "perform_minutes") ?? DEFAULT_PERFORM_MINUTES;
  const replace = str(formData, "replace") === "1";

  const { data: schoolRows } = await supabase
    .from("hosted_schools")
    .select("id, school_name")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: true });
  const schools = (
    (schoolRows as { id: string; school_name: string }[] | null) ?? []
  ).map((s) => ({ id: s.id, name: s.school_name }));

  if (schools.length === 0) {
    redirect(`/${slug}/hosting/${eventId}?error=noschools#schedule`);
  }

  if (replace) {
    await supabase
      .from("hosted_slots")
      .delete()
      .eq("program_id", programId)
      .eq("hosted_event_id", eventId);
  }

  const generated = generateHostSchedule({
    startUtcMs: startInstant!.getTime(),
    schools,
    warmupMinutes,
    performMinutes,
  });

  const { error } = await supabase.from("hosted_slots").insert(
    generated.map((g) => ({
      program_id: programId,
      hosted_event_id: eventId,
      hosted_school_id: g.hosted_school_id,
      kind: g.kind,
      label: g.label,
      starts_at: g.starts_at,
      duration_minutes: g.duration_minutes,
      sort_order: g.sort_order,
    })),
  );

  if (error) redirect(`/${slug}/hosting/${eventId}?error=save#schedule`);
  revalidatePath(`/${slug}/hosting/${eventId}`);
  redirect(`/${slug}/hosting/${eventId}?generated=1#schedule`);
}

// "Shift remaining" — move the given slot and every later slot (by starts_at) by
// ±minutes in one write set. Pure arithmetic in lib/hosting.computeShiftRemaining;
// this loads the timed slots, computes new times, and applies them.
export async function shiftRemainingSlots(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const slotId = str(formData, "slotId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`/${slug}/hosting?error=save`);
  if (guard.archived) redirect(`/${slug}/hosting/${eventId}?error=archived`);

  const deltaMinutes = intOrNull(formData, "delta_minutes");
  if (deltaMinutes == null || deltaMinutes === 0) {
    redirect(`/${slug}/hosting/${eventId}?error=delta#schedule`);
  }

  const { data: slotRows } = await supabase
    .from("hosted_slots")
    .select("id, starts_at")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);
  const slots =
    (slotRows as { id: string; starts_at: string | null }[] | null) ?? [];

  const updates = computeShiftRemaining(slots, slotId, deltaMinutes!);
  if (updates.length === 0) {
    redirect(`/${slug}/hosting/${eventId}?error=delta#schedule`);
  }

  // Apply each new starts_at. Scoped to program + event so a stray id can't reach
  // another tenant's row (RLS also blocks it — defense in depth).
  for (const u of updates) {
    await supabase
      .from("hosted_slots")
      .update({ starts_at: u.starts_at })
      .eq("id", u.id)
      .eq("program_id", programId)
      .eq("hosted_event_id", eventId);
  }

  revalidatePath(`/${slug}/hosting/${eventId}`);
  const dir = deltaMinutes! > 0 ? "later" : "earlier";
  redirect(
    `/${slug}/hosting/${eventId}?shifted=${Math.abs(deltaMinutes!)}&dir=${dir}#schedule`,
  );
}
