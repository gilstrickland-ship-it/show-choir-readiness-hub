import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropic, digestModel } from "@/lib/ai/client";
import { logAiUsage } from "@/lib/ai/usage";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserText,
  digestDraftSchema,
  type DigestDraftResult,
  type DigestWeekData,
} from "@/lib/ai/prompts/digest-draft/v1";
import { formatDateInTz, formatDateTimeInTz, formatTimeInTz } from "@/lib/datetime";

// Weekly digest gather + draft (§8, Constitution IV — AI draft-only). Extracted
// here so BOTH the Inngest cron AND the direct "Draft now" server action run the
// same code (mirrors the packet-parse pattern). Uses the service-role client: the
// cron has no user session, and the "Draft now" path re-checks director/admin
// before calling. NEVER call draftDigest during verification — it hits the Claude
// API. gatherWeek touches only the DB and is safe to unit-reason about.

// ---- Week window helpers ---------------------------------------------------

// Add whole days to a "YYYY-MM-DD" date string, returning the same shape. Used
// for the 7-day competition window (competitions.date is a plain date).
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ---- gatherWeek ------------------------------------------------------------

// Collect the next 7 days of program activity starting at `weekOf` (a
// "YYYY-MM-DD" date). Returns the structured data the prompt serializes — or null
// when the program can't be resolved. Aggregates alterations to counts only (no
// student names ever reach a parent digest — Principle III).
export async function gatherWeek(
  supabase: SupabaseClient,
  programId: string,
  weekOf: string,
): Promise<DigestWeekData | null> {
  const { data: progData } = await supabase
    .from("programs")
    .select("name, timezone, weekly_note")
    .eq("id", programId)
    .maybeSingle();
  const program = progData as
    | { name: string; timezone: string; weekly_note: string | null }
    | null;
  if (!program) return null;
  const tz = program.timezone;

  const weekEnd = addDaysToDateStr(weekOf, 7);
  // Instant bounds for timestamptz tables. weekOf/weekEnd are program-local
  // calendar days; noon UTC is a safe interior instant to derive the range
  // without a tz round-trip (digest windows are day-granular, not minute-exact).
  const startInstant = new Date(`${weekOf}T00:00:00Z`).toISOString();
  const endInstant = new Date(`${weekEnd}T00:00:00Z`).toISOString();

  const { data: seasonData } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", programId)
    .eq("is_active", true)
    .maybeSingle();
  const seasonId = (seasonData as { id: string } | null)?.id ?? null;

  // Competitions this week + published itinerary highlights.
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name, date")
    .eq("program_id", programId)
    .gte("date", weekOf)
    .lt("date", weekEnd)
    .order("date", { ascending: true });
  const compRows =
    (compData as { id: string; name: string; date: string | null }[] | null) ?? [];

  const competitions: DigestWeekData["competitions"] = [];
  for (const c of compRows) {
    const highlights: string[] = [];
    const { data: itin } = await supabase
      .from("itineraries")
      .select("id")
      .eq("program_id", programId)
      .eq("competition_id", c.id)
      .eq("status", "published")
      .maybeSingle();
    const itineraryId = (itin as { id: string } | null)?.id ?? null;
    if (itineraryId) {
      const { data: items } = await supabase
        .from("itinerary_items")
        .select("kind, starts_at")
        .eq("program_id", programId)
        .eq("itinerary_id", itineraryId)
        .in("kind", ["depart", "perform", "awards"])
        .not("starts_at", "is", null)
        .order("starts_at", { ascending: true });
      const seen = new Set<string>();
      const labelFor: Record<string, string> = {
        depart: "Depart",
        perform: "Perform",
        awards: "Awards",
      };
      for (const it of (items as { kind: string; starts_at: string }[] | null) ?? []) {
        if (seen.has(it.kind)) continue; // earliest of each kind
        seen.add(it.kind);
        highlights.push(`${labelFor[it.kind]} ${formatTimeInTz(it.starts_at, tz)}`);
      }
    }
    competitions.push({
      name: c.name,
      date: c.date ? formatDateInTz(`${c.date}T12:00:00Z`, tz) : null,
      highlights,
    });
  }

  // Events (rehearsals etc.) in the window.
  const { data: eventData } = await supabase
    .from("events")
    .select("title, starts_at, kind")
    .eq("program_id", programId)
    .not("starts_at", "is", null)
    .gte("starts_at", startInstant)
    .lt("starts_at", endInstant)
    .order("starts_at", { ascending: true });
  const events: DigestWeekData["events"] = (
    (eventData as { title: string; starts_at: string; kind: string }[] | null) ?? []
  ).map((e) => ({
    title: e.title,
    when: formatDateTimeInTz(e.starts_at, tz),
    kind: e.kind,
  }));

  // Shifts with open slots in the window.
  const openShifts: DigestWeekData["openShifts"] = [];
  const { data: shiftData } = await supabase
    .from("shifts")
    .select("id, title, starts_at, needed_count")
    .eq("program_id", programId)
    .not("starts_at", "is", null)
    .gte("starts_at", startInstant)
    .lt("starts_at", endInstant)
    .order("starts_at", { ascending: true });
  const shiftRows =
    (shiftData as
      | { id: string; title: string; starts_at: string; needed_count: number }[]
      | null) ?? [];
  if (shiftRows.length > 0) {
    const { data: suData } = await supabase
      .from("shift_signups")
      .select("shift_id")
      .eq("program_id", programId)
      .in(
        "shift_id",
        shiftRows.map((s) => s.id),
      )
      .eq("status", "confirmed");
    const filled = new Map<string, number>();
    for (const su of (suData as { shift_id: string }[] | null) ?? []) {
      filled.set(su.shift_id, (filled.get(su.shift_id) ?? 0) + 1);
    }
    for (const s of shiftRows) {
      const open = Math.max(0, s.needed_count - (filled.get(s.id) ?? 0));
      if (open > 0) {
        openShifts.push({
          title: s.title,
          when: formatDateTimeInTz(s.starts_at, tz),
          open,
        });
      }
    }
  }

  // Alterations — aggregate counts only, this season (Principle III: no names).
  const alterations = { needed: 0, inProgress: 0 };
  if (seasonId) {
    const { data: altData } = await supabase
      .from("costume_assignments")
      .select("alteration_status")
      .eq("program_id", programId)
      .eq("season_id", seasonId)
      .in("alteration_status", ["needed", "in_progress"]);
    for (const a of (altData as { alteration_status: string }[] | null) ?? []) {
      if (a.alteration_status === "needed") alterations.needed++;
      else if (a.alteration_status === "in_progress") alterations.inProgress++;
    }
  }

  const weekLabel = `${formatDateInTz(`${weekOf}T12:00:00Z`, tz)} – ${formatDateInTz(
    `${addDaysToDateStr(weekOf, 6)}T12:00:00Z`,
    tz,
  )}`;

  return {
    programName: program.name,
    weekLabel,
    timezone: tz,
    weeklyNote: program.weekly_note,
    competitions,
    events,
    openShifts,
    alterations,
  };
}

// ---- Claude draft ----------------------------------------------------------

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

async function callClaude(
  programId: string,
  userText: string,
): Promise<DigestDraftResult> {
  const anthropic = getAnthropic();
  const model = digestModel();
  let usageIn = 0;
  let usageOut = 0;

  // One retry on invalid JSON, nudging toward raw JSON (mirrors packet parse).
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix =
      attempt === 0
        ? ""
        : "\n\nYour previous response was not valid JSON matching the schema. Return ONLY the JSON object, no prose or fences.";
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: userText + suffix }] }],
    });
    usageIn += response.usage.input_tokens;
    usageOut += response.usage.output_tokens;

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    try {
      const parsed = digestDraftSchema.safeParse(JSON.parse(stripJsonFences(raw)));
      if (parsed.success) {
        logAiUsage({
          programId,
          feature: "digest-draft",
          model,
          promptVersion: PROMPT_VERSION,
          inputTokens: usageIn,
          outputTokens: usageOut,
        });
        return parsed.data;
      }
    } catch {
      // retry
    }
  }
  logAiUsage({
    programId,
    feature: "digest-draft",
    model,
    promptVersion: PROMPT_VERSION,
    inputTokens: usageIn,
    outputTokens: usageOut,
  });
  throw new Error("Model did not return valid JSON matching the digest schema.");
}

// ---- draftDigest -----------------------------------------------------------

export type DraftDigestResult =
  | { status: "drafted"; digestId: string }
  | { status: "skipped"; reason: string };

// Gather → draft → upsert a `draft` digests row for (program, week_of). Never
// clobbers an already-approved or already-sent digest for the same week (human
// work wins). Idempotent for a given week: a second draft updates the existing
// draft row rather than piling up duplicates.
export async function draftDigest(
  programId: string,
  weekOf: string,
): Promise<DraftDigestResult> {
  const supabase = createAdminClient();

  const week = await gatherWeek(supabase, programId, weekOf);
  if (!week) return { status: "skipped", reason: "program not found" };

  const draft = await callClaude(programId, buildUserText(week));
  const model = digestModel();

  // Upsert-by-hand: (program_id, week_of) has no unique index, so look first.
  const { data: existing } = await supabase
    .from("digests")
    .select("id, status")
    .eq("program_id", programId)
    .eq("week_of", weekOf)
    .maybeSingle();
  const row = existing as { id: string; status: string } | null;

  if (row && row.status !== "draft") {
    // approved/sent — leave the human's work alone.
    return { status: "skipped", reason: `existing digest is ${row.status}` };
  }

  if (row) {
    await supabase
      .from("digests")
      .update({
        subject: draft.subject,
        body_md: draft.body_md,
        model,
        prompt_version: PROMPT_VERSION,
      })
      .eq("id", row.id)
      .eq("program_id", programId);
    return { status: "drafted", digestId: row.id };
  }

  const { data: inserted } = await supabase
    .from("digests")
    .insert({
      program_id: programId,
      week_of: weekOf,
      status: "draft",
      subject: draft.subject,
      body_md: draft.body_md,
      model,
      prompt_version: PROMPT_VERSION,
    })
    .select("id")
    .single();
  return { status: "drafted", digestId: (inserted as { id: string }).id };
}
