"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { zonedWallToUtc } from "@/lib/datetime";
import {
  EVENTS_WRITE_ROLES,
  EVENT_KINDS,
  shiftedEndInstant,
} from "@/lib/events";
import { returnPath } from "@/lib/return-path";
import { ensemblesInProgram, resolveSeasonId } from "@/lib/competitions";

// General events CRUD + weekly repeat helper (§5a, T013). Writers: director/admin
// (events_write). Times arrive as program-tz wall clock and store UTC
// (Constitution VII). Recurring events are materialized as individual rows — no
// RRULE engine — so each is independently editable/deletable.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// Where a create/edit launched from the Season page goes back to. `from` is an
// opaque allow-listed key resolved server-side (lib/return-path) — never a
// client-supplied URL. Absent/unknown ⇒ null ⇒ today's redirects, unchanged.
function seasonReturn(fd: FormData, slug: string): string | null {
  return returnPath(slug, str(fd, "from"));
}

// A SPARSE save carries only the fields it edits (the Season page's row-edit
// popover: title, start, location). Full forms — the detail page's — carry the
// whole record, where an absent field still means "cleared", exactly as before.
function isSparse(fd: FormData): boolean {
  return str(fd, "sparse") === "1";
}

// Selected ensemble ids from the audience checkbox group. Zero = whole program
// (stored as zero event_ensembles rows, dynamic — Feature 004, research D2).
function ensembleIdsFrom(fd: FormData): string[] {
  return Array.from(
    new Set(
      fd
        .getAll("ensemble_ids")
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  );
}

// Shift a "YYYY-MM-DDTHH:MM" wall value by `weeks` weeks, keeping the wall clock
// (so a 7:00 PM rehearsal stays 7:00 PM across a DST boundary).
function addWeeksToWall(wall: string, weeks: number): string {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return wall;
  const [, y, mo, d, hh, mm] = m;
  const base = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  const yy = base.getUTCFullYear();
  const mm2 = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm2}-${dd}T${hh}:${mm}`;
}

export async function createEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, EVENTS_WRITE_ROLES);

  // Quick-add from the Season page comes back to Season with the drawer's event
  // section reopened on the same error message it always used.
  const back = seasonReturn(formData, slug);
  const fail = (code: string): string =>
    back ? `${back}?error=${code}&add=event` : `/${slug}/events?error=${code}`;

  const title = str(formData, "title");
  if (!title) redirect(fail("title"));
  if (!seasonId) redirect(fail("season"));

  const kindRaw = str(formData, "kind");
  const kind = (EVENT_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "other";
  const ensembleIds = ensembleIdsFrom(formData);
  const location = str(formData, "location") || null;
  const note = str(formData, "note") || null;
  const startsWall = str(formData, "starts_at");
  const endsWall = str(formData, "ends_at");

  // An event added from the Season page must have a start: the spine is
  // chronological, so an undated event would be created and then be invisible on
  // the very page the director is looking at. The Events page's own create keeps
  // allowing undated events — its calendar is not the only way to reach them.
  if (back && !startsWall) redirect(fail("starts"));

  // An end before its start is a typo, every time. Checking the first occurrence
  // is enough: a weekly repeat shifts both ends by the same whole weeks.
  const firstStart = zonedWallToUtc(startsWall, tz);
  const firstEnd = zonedWallToUtc(endsWall, tz);
  if (firstStart && firstEnd && firstEnd.getTime() < firstStart.getTime()) {
    redirect(fail("dates"));
  }

  // Repeat: weekly, count-limited (1 = single event).
  let count = Number(str(formData, "repeat_count")) || 1;
  if (count < 1) count = 1;
  if (count > 52) count = 52;

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const s = startsWall ? addWeeksToWall(startsWall, i) : "";
    const e = endsWall ? addWeeksToWall(endsWall, i) : "";
    const startsUtc = zonedWallToUtc(s, tz);
    const endsUtc = zonedWallToUtc(e, tz);
    rows.push({
      program_id: programId,
      season_id: seasonId,
      title,
      kind,
      location,
      note,
      starts_at: startsUtc ? startsUtc.toISOString() : null,
      ends_at: endsUtc ? endsUtc.toISOString() : null,
    });
  }

  const supabase = await createClient();

  // The season and the audience arrive as form fields. Being a director of
  // `programId` proves nothing about who owns those rows, so resolve both here
  // before anything is written (Constitution I). A repeat multiplies the damage:
  // one submit would otherwise plant a junction row per occurrence.
  if (!(await resolveSeasonId(supabase, programId, seasonId))) redirect(fail("season"));
  if (!(await ensemblesInProgram(supabase, programId, ensembleIds))) {
    redirect(fail("ensemble"));
  }

  const { data: inserted, error } = await supabase
    .from("events")
    .insert(rows)
    .select("id");
  if (error || !inserted) redirect(fail("save"));

  // Attach the targeted-ensemble subset to each materialized occurrence. Zero
  // ensembles selected ⇒ no junction rows ⇒ whole program (D2).
  if (ensembleIds.length > 0) {
    const junctionRows = (inserted as { id: string }[]).flatMap((ev) =>
      ensembleIds.map((ensemble_id) => ({
        program_id: programId,
        event_id: ev.id,
        ensemble_id,
      })),
    );
    const { error: junctionErr } = await supabase
      .from("event_ensembles")
      .insert(junctionRows);
    if (junctionErr) redirect(fail("save"));
  }

  revalidatePath(`/${slug}/events`);
  if (back) {
    revalidatePath(back);
    // A weekly repeat makes many rows; the spine highlights the first one. The
    // fragment scrolls it into view; ?created= is what highlights it, and still
    // does the whole job on its own.
    const key = `event-${(inserted as { id: string }[])[0]?.id ?? ""}`;
    redirect(`${back}?created=${key}#item-${key}`);
  }
  redirect(`/${slug}/events?created=${rows.length}`);
}

export async function updateEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, EVENTS_WRITE_ROLES);

  // Spine edit popover (Season page): failures reopen that row's popover, saves
  // land back on the spine. Allow-listed server-side; detail-page edits unchanged.
  const back = seasonReturn(formData, slug);
  const fail = (code: string): string =>
    back
      ? `${back}?error=${code}&edit=event-${eventId}`
      : `/${slug}/events/${eventId}?error=${code}`;

  // The spine popover edits three fields and sends three fields; everything it
  // doesn't send is left exactly as it is, instead of being cleared by a save
  // that had no opinion about it.
  const sparse = isSparse(formData);
  const sends = (key: string): boolean => !sparse || formData.get(key) !== null;

  const title = str(formData, "title");
  if (sends("title") && !title) redirect(fail("title"));

  const supabase = await createClient();

  // A sparse save needs the stored row: to move the end time along with the
  // start (below) and to date-check a start against an end it never carried.
  let current: { starts_at: string | null; ends_at: string | null } | null = null;
  if (sparse) {
    const { data } = await supabase
      .from("events")
      .select("starts_at, ends_at")
      .eq("id", eventId)
      .eq("program_id", programId)
      .maybeSingle();
    current = data as { starts_at: string | null; ends_at: string | null } | null;
  }

  const fields: Record<string, unknown> = {};
  if (sends("title")) fields.title = title;
  if (sends("kind")) {
    const kindRaw = str(formData, "kind");
    fields.kind = (EVENT_KINDS as readonly string[]).includes(kindRaw)
      ? kindRaw
      : "other";
  }
  if (sends("location")) fields.location = str(formData, "location") || null;
  if (sends("note")) fields.note = str(formData, "note") || null;

  const startsUtc = zonedWallToUtc(str(formData, "starts_at"), tz);
  const endsUtc = zonedWallToUtc(str(formData, "ends_at"), tz);
  if (sends("starts_at")) {
    fields.starts_at = startsUtc ? startsUtc.toISOString() : null;
  }
  if (sends("ends_at")) {
    fields.ends_at = endsUtc ? endsUtc.toISOString() : null;
  } else if (sends("starts_at")) {
    // Moving the start on the spine moves the end with it, so the event keeps
    // its length. Null when there's nothing to move — then ends_at is untouched.
    const shifted = shiftedEndInstant(
      current?.starts_at ?? null,
      (fields.starts_at as string | null) ?? null,
      current?.ends_at ?? null,
    );
    if (shifted) fields.ends_at = shifted;
  }

  // An end before its start is a typo, every time. Whichever side this save
  // supplied, it is checked against the value the row will actually hold.
  const nextStart = "starts_at" in fields
    ? (fields.starts_at as string | null)
    : current?.starts_at ?? null;
  const nextEnd = "ends_at" in fields
    ? (fields.ends_at as string | null)
    : current?.ends_at ?? null;
  if (nextStart && nextEnd && Date.parse(nextEnd) < Date.parse(nextStart)) {
    redirect(fail("dates"));
  }

  // .select("id") makes this write authoritative. Scoping the filter alone is
  // not enough: an eventId from another program matches zero rows and returns
  // NO error, and the junction block below would then run against it. Requiring
  // a row back means a foreign id stops here (Constitution I).
  const { data: updated, error } = await supabase
    .from("events")
    .update(fields)
    .eq("id", eventId)
    .eq("program_id", programId)
    .select("id");

  if (error || ((updated as { id: string }[] | null) ?? []).length === 0) {
    redirect(fail("save"));
  }

  // Replace the targeted-ensemble subset. Zero selected ⇒ whole program (D2).
  // Who an event is for is detail-page work, so a sparse save leaves it alone
  // rather than reading its silence as "nobody in particular".
  if (!sparse) {
    const ensembleIds = ensembleIdsFrom(formData);
    if (!(await ensemblesInProgram(supabase, programId, ensembleIds))) {
      redirect(fail("ensemble"));
    }
    const { error: delErr } = await supabase
      .from("event_ensembles")
      .delete()
      .eq("program_id", programId)
      .eq("event_id", eventId);
    if (delErr) redirect(fail("save"));
    if (ensembleIds.length > 0) {
      // A discarded error here is how an audience change reports success and
      // never lands — a duplicate-key collision is exactly what it looks like.
      const { error: insErr } = await supabase.from("event_ensembles").insert(
        ensembleIds.map((ensemble_id) => ({
          program_id: programId,
          event_id: eventId,
          ensemble_id,
        })),
      );
      if (insErr) redirect(fail("save"));
    }
  }

  revalidatePath(`/${slug}/events`);
  if (back) {
    revalidatePath(back);
    redirect(`${back}?saved=event-${eventId}#item-event-${eventId}`);
  }
  redirect(`/${slug}/events/${eventId}?saved=1`);
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  await requireRole(programId, EVENTS_WRITE_ROLES);

  const supabase = await createClient();
  await supabase.from("events").delete().eq("id", eventId).eq("program_id", programId);

  revalidatePath(`/${slug}/events`);
  redirect(`/${slug}/events`);
}
