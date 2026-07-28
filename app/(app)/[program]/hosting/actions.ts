"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { programPath } from "@/lib/return-path";
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
import {
  HOST_ANCHOR,
  hostOkSection,
  hostErrorSection,
  type HostOkKey,
  type HostErrorKey,
} from "./[eventId]/shared";

// Host-mode server actions (Wave I2, rebuilt in spec 005 Wave 7). Writes are
// director/admin (HOSTING_WRITE_ROLES); every action re-checks the role via
// requireRole (Constitution I) even though RLS also gates it. Season-archived
// events are frozen at the RLS layer; we pre-check here to surface a friendly
// ?error=archived instead of a raw failure (mirrors the ArchivedBanner posture
// on season-scoped surfaces).
//
// CROSS-PROGRAM REFERENCES (Constitution I). Every id below arrives as a form
// field, and requireRole only proves the caller runs THIS program — not that the
// event/school/slot/season they posted belongs to it. Anyone can self-serve a
// program at /launch, so an unresolved id lets them write a row that points into
// someone else's data. Resolve first, scoped to programId (and to the event,
// where the row belongs to one), and fail closed to the surface's error
// convention when the row isn't there.
//
// Every redirect target is BUILT, never interpolated: the slug arrives as a form
// field, and a value like "/evil.com" makes "//evil.com/hosting" — which every
// browser reads as a protocol-relative URL and follows off-site. programPath is
// the allow-list; anything that isn't a program slug lands on "/".

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hostingPath(slug: string): string {
  return programPath(slug, "hosting") ?? "/";
}

// The event page's path, or the hosting list when the id isn't an id — an
// eventId that isn't a uuid can never be a row here, and interpolating it would
// let a form field write query string or fragment into the target.
function eventPath(slug: string, eventId: string): string {
  const path = UUID.test(eventId)
    ? programPath(slug, `hosting/${eventId}`)
    : null;
  return path ?? hostingPath(slug);
}

// `?ok=` / `?error=` + the anchor of the section that owns the message. The
// section comes from the same map the page reads it back with, so the two halves
// cannot drift; `open` reopens the disclosure the message belongs to (a row by
// id, or the word for a section-level form).
function okTo(
  slug: string,
  eventId: string,
  key: HostOkKey,
  open?: string,
): string {
  const q = open ? `?ok=${key}&open=${encodeURIComponent(open)}` : `?ok=${key}`;
  return `${eventPath(slug, eventId)}${q}#${HOST_ANCHOR[hostOkSection(key)]}`;
}

function errTo(
  slug: string,
  eventId: string,
  key: HostErrorKey,
  open?: string,
): string {
  const q = open
    ? `?error=${key}&open=${encodeURIComponent(open)}`
    : `?error=${key}`;
  return `${eventPath(slug, eventId)}${q}#${HOST_ANCHOR[hostErrorSection(key)]}`;
}

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

// Resolve an invitational's first/last day from the form, validating the span
// (Wave N). Returns the pair to persist — with end_date normalized to null when
// the event is single-day (no last day, or a last day equal to the first) — or
// null when the span is invalid, so the caller redirects with a friendly
// ?error=enddate rather than writing an inverted range. "YYYY-MM-DD" date strings
// compare lexicographically, so a plain string compare is a correct date compare.
function resolveHostedDates(
  fd: FormData,
): { event_date: string | null; end_date: string | null } | null {
  const eventDate = nullable(fd, "event_date");
  const endDate = nullable(fd, "end_date");
  if (!endDate) return { event_date: eventDate, end_date: null };
  if (!eventDate) return null; // a last day with no first day is meaningless
  if (endDate < eventDate) return null; // last day before first — reject
  if (endDate === eventDate) return { event_date: eventDate, end_date: null };
  return { event_date: eventDate, end_date: endDate };
}

// Resolve a row inside BOTH this program and this hosted event. Returns the id
// when it belongs here, null when the field was blank (only meaningful for the
// optional school on a slot), and false when it belongs to someone else — or to
// another invitational of this program, which would corrupt the host schedule
// and the door-sign PDFs just as thoroughly.
//
// hosted_slots.hosted_school_id in particular is written straight from a
// <select>, and no policy, constraint or trigger looks at it — so an unresolved
// id files a slot against another program's school, which then blocks that
// program from ever deleting the school (Constitution I).
async function resolveInEvent(
  supabase: SupabaseClient,
  table: "hosted_schools" | "hosted_slots",
  programId: string,
  eventId: string,
  id: string | null,
): Promise<string | null | false> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? false;
}

// Resolve an event to its program + season + archived flag, scoped to programId.
// Returns null when the event is missing/hidden (RLS) — the caller bounces.
async function loadEventGuard(
  supabase: SupabaseClient,
  programId: string,
  eventId: string,
): Promise<{ seasonId: string; archived: boolean } | null> {
  if (!UUID.test(eventId)) return null;
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

  const list = hostingPath(slug);
  const name = str(formData, "name");
  if (!name) redirect(`${list}?error=name`);
  if (!seasonId) redirect(`${list}?error=season`);
  const dates = resolveHostedDates(formData);
  if (!dates) redirect(`${list}?error=enddate`);

  const supabase = await createClient();

  // seasonId is a hidden field; resolve it inside this program before writing,
  // so an edited field can't hang an invitational off another program's season
  // (Constitution I).
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  if (!season) redirect(`${list}?error=season`);

  const { data, error } = await supabase
    .from("hosted_events")
    .insert({
      program_id: programId,
      season_id: seasonId,
      name,
      event_date: dates!.event_date,
      end_date: dates!.end_date,
      status: "planning",
    })
    .select("id")
    .single();

  if (error || !data) redirect(`${list}?error=save`);

  revalidatePath(list);
  redirect(okTo(slug, (data as { id: string }).id, "created"));
}

// Overview's edit disclosure: the invitational's own facts. The form shows the
// whole record and posts the whole record, so an emptied field clears.
export async function updateHostedEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const name = str(formData, "name");
  if (!name) redirect(errTo(slug, eventId, "name"));
  const dates = resolveHostedDates(formData);
  if (!dates) redirect(errTo(slug, eventId, "enddate"));
  const status = str(formData, "status") as HostedEventStatus;

  const { error } = await supabase
    .from("hosted_events")
    .update({
      name,
      event_date: dates!.event_date,
      end_date: dates!.end_date,
      venue_notes: nullable(formData, "venue_notes"),
      host_contact: nullable(formData, "host_contact"),
      status: HOSTED_EVENT_STATUSES.includes(status) ? status : "planning",
    })
    .eq("id", eventId)
    .eq("program_id", programId);

  if (error) redirect(errTo(slug, eventId, "save"));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "saved"));
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
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const fields = schoolFields(formData);
  if (!fields.school_name) {
    redirect(errTo(slug, eventId, "school_name", "school"));
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
  const nextSort =
    ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("hosted_schools").insert({
    program_id: programId,
    hosted_event_id: eventId,
    ...fields,
    sort_order: nextSort,
  });

  if (error) redirect(errTo(slug, eventId, "school_save", "school"));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "school_saved"));
}

export async function updateHostedSchool(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const schoolId = str(formData, "schoolId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  // The card that posted this is one of THIS invitational's — prove it before
  // writing, rather than letting a scoped UPDATE match nothing and report
  // "School saved." over a row that was never touched.
  const owned = await resolveInEvent(
    supabase,
    "hosted_schools",
    programId,
    eventId,
    schoolId || null,
  );
  if (!owned) redirect(errTo(slug, eventId, "school_missing"));

  const fields = schoolFields(formData);
  if (!fields.school_name) {
    redirect(errTo(slug, eventId, "school_name", owned as string));
  }
  const sortOrder = intOrNull(formData, "sort_order");

  const { error } = await supabase
    .from("hosted_schools")
    .update({
      ...fields,
      ...(sortOrder != null ? { sort_order: sortOrder } : {}),
    })
    .eq("id", owned)
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);

  if (error) redirect(errTo(slug, eventId, "school_save", owned as string));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "school_saved"));
}

export async function removeHostedSchool(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const schoolId = str(formData, "schoolId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const owned = await resolveInEvent(
    supabase,
    "hosted_schools",
    programId,
    eventId,
    schoolId || null,
  );
  if (!owned) redirect(errTo(slug, eventId, "school_missing"));

  // Detach any slots pointing at this school (they become label-only rows)
  // before deleting, so a school removal never orphans a schedule row's FK.
  await supabase
    .from("hosted_slots")
    .update({ hosted_school_id: null })
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .eq("hosted_school_id", owned);

  const { error } = await supabase
    .from("hosted_schools")
    .delete()
    .eq("id", owned)
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);

  if (error) redirect(errTo(slug, eventId, "school_save", owned as string));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "school_removed"));
}

// ---- Slots -----------------------------------------------------------------

export async function addHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const kind = str(formData, "kind") as HostedSlotKind;
  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at"); // datetime-local, program tz
  const startsAt = startWall
    ? (zonedWallToUtc(startWall, tz)?.toISOString() ?? null)
    : null;

  const { data: last } = await supabase
    .from("hosted_slots")
    .select("sort_order")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort =
    ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const schoolId = await resolveInEvent(
    supabase,
    "hosted_schools",
    programId,
    eventId,
    nullable(formData, "hosted_school_id"),
  );
  if (schoolId === false) {
    redirect(errTo(slug, eventId, "school", "slot"));
  }

  const { error } = await supabase.from("hosted_slots").insert({
    program_id: programId,
    hosted_event_id: eventId,
    hosted_school_id: schoolId,
    kind: HOSTED_SLOT_KINDS.includes(kind) ? kind : "other",
    label: nullable(formData, "label"),
    starts_at: startsAt,
    duration_minutes: intOrNull(formData, "duration_minutes"),
    sort_order: nextSort,
  });

  if (error) redirect(errTo(slug, eventId, "slot_save", "slot"));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "slot_saved"));
}

export async function updateHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const slotId = str(formData, "slotId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const ownedSlot = await resolveInEvent(
    supabase,
    "hosted_slots",
    programId,
    eventId,
    slotId || null,
  );
  if (!ownedSlot) redirect(errTo(slug, eventId, "slot_missing"));

  const kind = str(formData, "kind") as HostedSlotKind;
  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at");
  const startsAt = startWall
    ? (zonedWallToUtc(startWall, tz)?.toISOString() ?? null)
    : null;

  const schoolId = await resolveInEvent(
    supabase,
    "hosted_schools",
    programId,
    eventId,
    nullable(formData, "hosted_school_id"),
  );
  if (schoolId === false) {
    redirect(errTo(slug, eventId, "school", ownedSlot as string));
  }

  const { error } = await supabase
    .from("hosted_slots")
    .update({
      hosted_school_id: schoolId,
      kind: HOSTED_SLOT_KINDS.includes(kind) ? kind : "other",
      label: nullable(formData, "label"),
      starts_at: startsAt,
      duration_minutes: intOrNull(formData, "duration_minutes"),
    })
    .eq("id", ownedSlot)
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);

  if (error) redirect(errTo(slug, eventId, "slot_save", ownedSlot as string));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "slot_saved"));
}

export async function removeHostedSlot(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const slotId = str(formData, "slotId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const ownedSlot = await resolveInEvent(
    supabase,
    "hosted_slots",
    programId,
    eventId,
    slotId || null,
  );
  if (!ownedSlot) redirect(errTo(slug, eventId, "slot_missing"));

  const { error } = await supabase
    .from("hosted_slots")
    .delete()
    .eq("id", ownedSlot)
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);

  if (error) redirect(errTo(slug, eventId, "slot_save", ownedSlot as string));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "slot_removed"));
}

// "Generate schedule" — materialize the deterministic warm-up/perform ladder for
// every school in sort_order. When the replace flag is set (a schedule already
// exists, and the panel says so next to a button that names it), the current
// schedule is cleared first. Pure ladder math lives in
// lib/hosting.generateHostSchedule.
export async function generateHostedSchedule(
  formData: FormData,
): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, HOSTING_WRITE_ROLES);

  const supabase = await createClient();
  const guard = await loadEventGuard(supabase, programId, eventId);
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const tz = str(formData, "tz") || "UTC";
  const startWall = str(formData, "starts_at");
  const startInstant = startWall ? zonedWallToUtc(startWall, tz) : null;
  if (!startInstant) redirect(errTo(slug, eventId, "start", "generate"));

  const warmupMinutes =
    intOrNull(formData, "warmup_minutes") ?? DEFAULT_WARMUP_MINUTES;
  const performMinutes =
    intOrNull(formData, "perform_minutes") ?? DEFAULT_PERFORM_MINUTES;
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
    redirect(errTo(slug, eventId, "noschools", "generate"));
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

  if (error) redirect(errTo(slug, eventId, "slot_save", "generate"));
  revalidatePath(eventPath(slug, eventId));
  redirect(okTo(slug, eventId, "generated"));
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
  if (!guard) redirect(`${hostingPath(slug)}?error=save`);
  if (guard.archived) redirect(errTo(slug, eventId, "archived"));

  const ownedSlot = await resolveInEvent(
    supabase,
    "hosted_slots",
    programId,
    eventId,
    slotId || null,
  );
  if (!ownedSlot) redirect(errTo(slug, eventId, "slot_missing"));

  const deltaMinutes = intOrNull(formData, "delta_minutes");
  if (deltaMinutes == null || deltaMinutes === 0) {
    redirect(errTo(slug, eventId, "delta", ownedSlot as string));
  }
  // Program tz scopes the shift to the pivot's calendar day (Wave N) — day 2 of a
  // multi-day invitational stays put when day 1 runs behind. Posted by the form.
  const tz = str(formData, "tz") || "UTC";

  const { data: slotRows } = await supabase
    .from("hosted_slots")
    .select("id, starts_at")
    .eq("program_id", programId)
    .eq("hosted_event_id", eventId);
  const slots =
    (slotRows as { id: string; starts_at: string | null }[] | null) ?? [];

  const updates = computeShiftRemaining(
    slots,
    ownedSlot as string,
    deltaMinutes!,
    tz,
  );
  if (updates.length === 0) {
    redirect(errTo(slug, eventId, "delta", ownedSlot as string));
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

  revalidatePath(eventPath(slug, eventId));
  redirect(
    okTo(
      slug,
      eventId,
      deltaMinutes! > 0 ? "shifted_later" : "shifted_earlier",
      ownedSlot as string,
    ),
  );
}
