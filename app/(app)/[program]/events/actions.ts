"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { zonedWallToUtc } from "@/lib/datetime";
import { EVENTS_WRITE_ROLES, EVENT_KINDS } from "@/lib/events";

// General events CRUD + weekly repeat helper (§5a, T013). Writers: director/admin
// (events_write). Times arrive as program-tz wall clock and store UTC
// (Constitution VII). Recurring events are materialized as individual rows — no
// RRULE engine — so each is independently editable/deletable.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
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

  const title = str(formData, "title");
  if (!title) redirect(`/${slug}/events?error=title`);
  if (!seasonId) redirect(`/${slug}/events?error=season`);

  const kindRaw = str(formData, "kind");
  const kind = (EVENT_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "other";
  const ensembleId = str(formData, "ensemble_id") || null;
  const location = str(formData, "location") || null;
  const note = str(formData, "note") || null;
  const startsWall = str(formData, "starts_at");
  const endsWall = str(formData, "ends_at");

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
      ensemble_id: ensembleId,
      title,
      kind,
      location,
      note,
      starts_at: startsUtc ? startsUtc.toISOString() : null,
      ends_at: endsUtc ? endsUtc.toISOString() : null,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("events").insert(rows);
  if (error) redirect(`/${slug}/events?error=save`);

  revalidatePath(`/${slug}/events`);
  redirect(`/${slug}/events?created=${rows.length}`);
}

export async function updateEvent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const eventId = str(formData, "eventId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, EVENTS_WRITE_ROLES);

  const title = str(formData, "title");
  if (!title) redirect(`/${slug}/events/${eventId}?error=title`);

  const kindRaw = str(formData, "kind");
  const kind = (EVENT_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "other";
  const startsUtc = zonedWallToUtc(str(formData, "starts_at"), tz);
  const endsUtc = zonedWallToUtc(str(formData, "ends_at"), tz);

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({
      title,
      kind,
      ensemble_id: str(formData, "ensemble_id") || null,
      location: str(formData, "location") || null,
      note: str(formData, "note") || null,
      starts_at: startsUtc ? startsUtc.toISOString() : null,
      ends_at: endsUtc ? endsUtc.toISOString() : null,
    })
    .eq("id", eventId)
    .eq("program_id", programId);

  if (error) redirect(`/${slug}/events/${eventId}?error=save`);
  revalidatePath(`/${slug}/events`);
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
