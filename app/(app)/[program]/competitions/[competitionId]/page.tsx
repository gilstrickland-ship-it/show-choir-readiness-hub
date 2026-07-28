import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  ATTENDANCE_WRITE_ROLES,
  COMMON_CAPTIONS,
  COMPETITION_STATUS_LABELS,
  activeCaptions,
  competitionEnsembleIds,
  competitionRoster,
} from "@/lib/competitions";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { loadCompReadiness } from "@/lib/readiness";
import { loadMealData } from "@/lib/pdf/queries";
import {
  formatDateInTz,
  formatTimeInTz,
  zonedWallToUtc,
} from "@/lib/datetime";
import { setAttendance } from "./attendance/actions";
import {
  updateCompetition,
  reseedAttendance,
  saveResults,
} from "../actions";

// Competition command center (season-workflow redesign, "Competition" design
// ref) — comp week on one page. The five old tabs (Overview/Attendance/
// Itinerary/Meals/Packet) become anchored sections, plus a Results section and a
// sticky readiness/papers/travel rail. The heavy full-list editing flows still
// live on their own routes (attendance/itinerary/meals/packet); this page shows
// the light view + the exact same server actions, and links out for the rest.
//
// Same lean-by-construction rule the rest of the app follows: a section's
// backing query runs ONLY when its flag is on AND the caller's role has read
// access (shifts, packet, travel). Reads only here — every mutation reuses an
// existing server action untouched.

export const dynamic = "force-dynamic";

// Whole days from `now` to `target` (future). Past clamps to 0.
function countdownDays(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "planned" },
  confirmed: { label: "Confirmed", cls: "confirmed" },
  done: { label: "Done", cls: "done" },
};

const PACKET_CHIP: Record<string, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "" },
  running: { label: "Running", tone: "" },
  review: { label: "Ready to review", tone: "warn" },
  accepted: { label: "Parse accepted", tone: "ok" },
  failed: { label: "Failed", tone: "alert" },
};

const ATT_TOGGLE: Array<{ key: "expected" | "partial" | "absent"; label: string }> = [
  { key: "expected", label: "Expected" },
  { key: "partial", label: "Partial" },
  { key: "absent", label: "Absent" },
];

// How many attendance rows to show inline before "All N students →".
const ATT_PREVIEW = 12;

// Map a readiness check's outbound href to the matching on-page anchor.
function anchorFor(href: string): string {
  if (href.includes("/itinerary")) return "#itinerary";
  if (href.includes("/attendance")) return "#attendance";
  if (href.includes("/shifts")) return "#shifts";
  if (href.includes("/meals")) return "#meals";
  if (href.includes("/packet")) return "#packet";
  return "#top";
}

interface CompDetail {
  id: string;
  season_id: string;
  name: string;
  host_school: string | null;
  venue_address: string | null;
  date: string | null;
  showchoir_com_url: string | null;
  status: "planned" | "confirmed" | "done";
}

interface EnsembleRow {
  id: string;
  name: string;
}

interface ResultsRow {
  placement: string | null;
  division: string | null;
  score: number | null;
  captions: Record<string, unknown> | null;
  notes: string | null;
}

export default async function CompetitionCommandCenter({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    error?: string;
    reseeded?: string;
    results?: string;
    confirm?: string;
    pending_ensembles?: string;
  }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role, flags } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const canEditAttendance = ATTENDANCE_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const now = new Date();
  const sp = await searchParams;
  const base = `/${slug}`;
  const compBase = `${base}/competitions/${competitionId}`;

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select(
      "id, season_id, name, host_school, venue_address, date, showchoir_com_url, status",
    )
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as CompDetail | null;
  if (!comp) notFound();

  // Participating ensembles (junction, Feature 004). ≥1 for a well-formed comp;
  // an empty set only appears mid-edit and is treated as "not seeded yet".
  const participatingEnsembleIds = await competitionEnsembleIds(supabase, competitionId);
  const hasEnsembles = participatingEnsembleIds.length > 0;

  // ---- Readiness (shared 5-check helper — feeds both the rail + countdown) ---
  const readiness = await loadCompReadiness(supabase, {
    programId: program.id,
    comp: {
      id: comp.id,
      name: comp.name,
      date: comp.date,
      host_school: comp.host_school,
    },
    flags,
    role,
    base,
  });

  // Countdown target: earliest itinerary time, else the comp date at midnight tz.
  let daysOut: number | null = null;
  const target = readiness.firstStart
    ? new Date(readiness.firstStart)
    : comp.date
      ? zonedWallToUtc(`${comp.date}T00:00`, tz)
      : null;
  if (target && !Number.isNaN(target.getTime())) {
    daysOut = countdownDays(target, now);
  }

  // Per-section gates (flag on AND role has read access).
  const showShifts = flags.shifts && SHIFT_WRITE_ROLES.includes(role);
  const showPacket = flags.packet_parse;
  const showTravel = flags.travel;

  // ---- Itinerary items ------------------------------------------------------
  interface ItinItem {
    id: string;
    starts_at: string | null;
    kind: string;
    title: string | null;
    location: string | null;
    details: string | null;
  }
  let itinPublished = false;
  let itinItems: ItinItem[] = [];
  {
    const { data: itinRow } = await supabase
      .from("itineraries")
      .select("id, status")
      .eq("program_id", program.id)
      .eq("competition_id", competitionId)
      .maybeSingle();
    const itin = itinRow as { id: string; status: string } | null;
    itinPublished = itin?.status === "published";
    if (itin) {
      const { data: itemRows } = await supabase
        .from("itinerary_items")
        .select("id, starts_at, kind, title, location, details, sort_order")
        .eq("itinerary_id", itin.id)
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true })
        .order("starts_at", { ascending: true, nullsFirst: false });
      itinItems = (itemRows as (ItinItem & { sort_order: number })[] | null) ?? [];
    }
  }

  // ---- Attendance rows (summary + inline preview) ---------------------------
  interface AttRow {
    student_id: string;
    status: "expected" | "absent" | "partial";
    note: string | null;
    students: { first_name: string; last_name: string } | null;
  }
  const { data: attData } = await supabase
    .from("attendance")
    .select("student_id, status, note, students(first_name, last_name)")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId);
  const attRows = ((attData as AttRow[] | null) ?? []).slice().sort((a, b) => {
    const an = `${a.students?.last_name ?? ""} ${a.students?.first_name ?? ""}`;
    const bn = `${b.students?.last_name ?? ""} ${b.students?.first_name ?? ""}`;
    return an.localeCompare(bn);
  });
  const attCounts = { expected: 0, partial: 0, absent: 0 } as Record<string, number>;
  for (const a of attRows) attCounts[a.status] = (attCounts[a.status] ?? 0) + 1;
  const attPreview = attRows.slice(0, ATT_PREVIEW);

  // ---- Volunteer shifts -----------------------------------------------------
  interface ShiftCard {
    id: string;
    title: string;
    starts_at: string | null;
    ends_at: string | null;
    needed: number;
    filled: number;
  }
  let shiftCards: ShiftCard[] = [];
  if (showShifts) {
    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("id, title, starts_at, ends_at, needed_count")
      .eq("program_id", program.id)
      .eq("competition_id", competitionId)
      .order("starts_at", { ascending: true, nullsFirst: false });
    const rows =
      (shiftRows as {
        id: string;
        title: string;
        starts_at: string | null;
        ends_at: string | null;
        needed_count: number;
      }[] | null) ?? [];
    if (rows.length > 0) {
      const { data: suData } = await supabase
        .from("shift_signups")
        .select("shift_id")
        .eq("program_id", program.id)
        .eq("status", "confirmed")
        .in(
          "shift_id",
          rows.map((s) => s.id),
        );
      const filled = new Map<string, number>();
      for (const su of (suData as { shift_id: string }[] | null) ?? []) {
        filled.set(su.shift_id, (filled.get(su.shift_id) ?? 0) + 1);
      }
      shiftCards = rows.map((s) => ({
        id: s.id,
        title: s.title,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        needed: s.needed_count,
        filled: Math.min(s.needed_count, filled.get(s.id) ?? 0),
      }));
    }
  }

  // ---- Meal count (shared loader — same rule the meal PDF uses) -------------
  const meal = await loadMealData(supabase, competitionId);

  // ---- Host packet (latest document + parse) --------------------------------
  interface PacketState {
    fileName: string;
    uploadedAt: string;
    status: string | null;
    parseId: string | null;
  }
  let packet: PacketState | null = null;
  if (showPacket) {
    const { data: docRow } = await supabase
      .from("documents")
      .select("id, storage_path, created_at")
      .eq("program_id", program.id)
      .eq("competition_id", competitionId)
      .eq("kind", "host_packet")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const doc = docRow as
      | { id: string; storage_path: string; created_at: string }
      | null;
    if (doc) {
      const { data: parseRow } = await supabase
        .from("packet_parses")
        .select("id, status")
        .eq("program_id", program.id)
        .eq("competition_id", competitionId)
        .eq("document_id", doc.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const parse = parseRow as { id: string; status: string } | null;
      packet = {
        fileName: doc.storage_path.split("/").pop() ?? "Host packet",
        uploadedAt: doc.created_at,
        status: parse?.status ?? null,
        parseId: parse?.id ?? null,
      };
    }
  }

  // ---- Linked trip ----------------------------------------------------------
  interface TripLink {
    id: string;
    name: string;
    starts_on: string | null;
    ends_on: string | null;
    is_overnight: boolean;
  }
  let trip: TripLink | null = null;
  if (showTravel) {
    const { data: tripRow } = await supabase
      .from("trips")
      .select("id, name, starts_on, ends_on, is_overnight")
      .eq("program_id", program.id)
      .eq("competition_id", competitionId)
      .order("starts_on", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    trip = (tripRow as TripLink | null) ?? null;
  }

  // ---- Results + edit-form scaffolding --------------------------------------
  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];

  const { data: resultsData } = await supabase
    .from("competition_results")
    .select("placement, division, score, captions, notes")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const results = resultsData as ResultsRow | null;
  const chosenCaptions = new Set(activeCaptions(results?.captions));

  const ensembleName = new Map(ensembles.map((e) => [e.id, e.name]));

  // ---- Ensemble-change confirmation (generalized invariant §9.2) ------------
  // The edit form posts the intended NEW ensemble set as `pending_ensembles`
  // (comma-joined) when a removal needs acknowledgement. Name the students who
  // would lose eligibility: members of a removed ensemble in NO remaining one.
  const confirmEnsemble = sp.confirm === "ensemble" && canWrite;
  const pendingEnsembleIds = (sp.pending_ensembles ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pendingNames = pendingEnsembleIds
    .map((id) => ensembleName.get(id) ?? "?")
    .join(", ");
  let affectedNames: string[] = [];
  if (confirmEnsemble && pendingEnsembleIds.length > 0) {
    const removedIds = participatingEnsembleIds.filter(
      (id) => !pendingEnsembleIds.includes(id),
    );
    if (removedIds.length > 0) {
      const removedStudents = await competitionRoster(supabase, {
        programId: program.id,
        seasonId: comp.season_id,
        ensembleIds: removedIds,
      });
      const remaining = new Set(
        await competitionRoster(supabase, {
          programId: program.id,
          seasonId: comp.season_id,
          ensembleIds: pendingEnsembleIds,
        }),
      );
      const toRemove = removedStudents.filter((id) => !remaining.has(id));
      if (toRemove.length > 0) {
        const { data: nameRows } = await supabase
          .from("students")
          .select("id, first_name, last_name")
          .eq("program_id", program.id)
          .in("id", toRemove);
        affectedNames = ((nameRows as { first_name: string; last_name: string }[] | null) ?? [])
          .map((s) => `${s.last_name}, ${s.first_name}`)
          .sort((a, b) => a.localeCompare(b));
      }
    }
  }

  const statusPill = STATUS_PILL[comp.status] ?? STATUS_PILL.planned;
  const metaLine = [
    comp.date ? formatDateInTz(`${comp.date}T12:00:00Z`, tz) : "No date set",
    comp.host_school,
    comp.venue_address,
    readiness.firstStart ? `call ${formatTimeInTz(readiness.firstStart, tz)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="comp" id="top">
      <p className="comp-back">
        <Link href={`${base}/season`}>← Season</Link>
      </p>

      {sp.created && <p className="alert-ok">Competition created. Attendance seeded.</p>}
      {sp.saved && <p className="alert-ok">Saved.</p>}
      {sp.reseeded && (
        <p className="alert-ok">Attendance reseeded (expected for everyone new).</p>
      )}
      {sp.results && <p className="alert-ok">Results saved.</p>}
      {sp.error === "name" && <p className="alert-error">A competition needs a name.</p>}
      {sp.error === "ensemble" && (
        <p className="alert-error">Pick at least one ensemble for the competition.</p>
      )}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {sp.error === "results" && <p className="alert-error">Couldn&apos;t save results.</p>}

      {/* ---- Header ---- */}
      <div className="comp-head">
        <div className="comp-head-titles">
          <div className="comp-status-row">
            <span className={`comp-status-pill ${statusPill.cls}`}>{statusPill.label}</span>
            {comp.status !== "done" && daysOut != null && (
              <span className="comp-countdown">
                {daysOut === 0 ? "Today" : `In ${daysOut} day${daysOut === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
          <h1 className="comp-h1">{comp.name}</h1>
          <p className="comp-meta">{metaLine}</p>
          {hasEnsembles && (
            <p className="row-inline" style={{ gap: "0.3rem", flexWrap: "wrap" }}>
              {participatingEnsembleIds.map((eid) => (
                <span className="chip" key={eid}>
                  {ensembleName.get(eid) ?? "?"}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="comp-head-actions">
          {canWrite && (
            <Link href="#details" className="button-link secondary">
              Edit details
            </Link>
          )}
          <a href={`/api/pdf/packet?competition=${competitionId}`} className="button-link">
            Download parent packet (PDF)
          </a>
        </div>
      </div>

      {/* ---- Ensemble-change confirmation (generalized invariant §9.2) ---- */}
      {confirmEnsemble && (
        <div className="stack confirm-box">
          <p>
            Set participating ensembles to <strong>{pendingNames || "none"}</strong>?
          </p>
          {affectedNames.length > 0 ? (
            <p>
              This removes {affectedNames.length} student
              {affectedNames.length === 1 ? "" : "s"} from this competition&apos;s
              attendance, meals, travel, and checkout — their attendance rows and
              comp-scoped costume checkouts are released. Students in a remaining
              ensemble are untouched. Affected:{" "}
              <strong>{affectedNames.join("; ")}</strong>.
            </p>
          ) : (
            <p className="muted">
              No students lose eligibility (everyone removed is still in a remaining
              ensemble). Newly added ensembles are seeded expected.
            </p>
          )}
          <form action={updateCompetition} className="row-inline">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={comp.id} />
            <input type="hidden" name="seasonId" value={comp.season_id} />
            {pendingEnsembleIds.map((id) => (
              <input type="hidden" name="ensemble_ids" value={id} key={id} />
            ))}
            <input type="hidden" name="confirm_ensemble" value="1" />
            <input type="hidden" name="name" value={comp.name} />
            <input type="hidden" name="host_school" value={comp.host_school ?? ""} />
            <input type="hidden" name="venue_address" value={comp.venue_address ?? ""} />
            <input type="hidden" name="date" value={comp.date ?? ""} />
            <input type="hidden" name="showchoir_com_url" value={comp.showchoir_com_url ?? ""} />
            <input type="hidden" name="status" value={comp.status} />
            <button type="submit" className="danger">
              Confirm &amp; update ensembles
            </button>
            <Link href={compBase}>Cancel</Link>
          </form>
        </div>
      )}

      {/* ---- Body ---- */}
      <div className="comp-body">
        <div className="comp-main">
          {/* ---- Itinerary ---- */}
          <section className="comp-section" id="itinerary">
            <div className="comp-section-head">
              <h2>
                Itinerary{" "}
                <span className={`comp-chip ${itinPublished ? "ok" : ""}`}>
                  {itinPublished ? "Published" : "Draft"}
                </span>
              </h2>
              <div className="comp-section-links">
                <Link href={`${compBase}/itinerary`}>
                  {canWrite ? "Edit items" : "View items"}
                </Link>
                <Link href={`${compBase}/itinerary`}>Share link</Link>
              </div>
            </div>
            {itinItems.length === 0 ? (
              <p className="muted">
                No itinerary items yet.{" "}
                <Link href={`${compBase}/itinerary`}>
                  {canWrite ? "Build the itinerary →" : "View the itinerary →"}
                </Link>
              </p>
            ) : (
              <div className="comp-rows">
                {itinItems.map((item) => {
                  const perform =
                    item.kind === "perform" || /perform/i.test(item.title ?? "");
                  const detail = [item.location, item.details].filter(Boolean).join(" · ");
                  return (
                    <div className="comp-itin-row" key={item.id}>
                      <span className={`comp-itin-time${perform ? " perform" : ""}`}>
                        {item.starts_at ? formatTimeInTz(item.starts_at, tz) : "—"}
                      </span>
                      <span className="comp-itin-body">
                        <strong className={perform ? "perform" : ""}>
                          {item.title ?? "Untitled"}
                        </strong>
                        {detail ? <span className="muted"> · {detail}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- Attendance ---- */}
          <section className="comp-section" id="attendance">
            <div className="comp-section-head">
              <h2>Attendance</h2>
              <span className="comp-att-summary">
                {attCounts.expected} expected · {attCounts.partial} partial ·{" "}
                {attCounts.absent} absent
              </span>
            </div>
            {attRows.length === 0 ? (
              <p className="muted">
                No attendance rows yet.{" "}
                {hasEnsembles
                  ? "Reseed from Edit details below."
                  : "Add at least one ensemble in Edit details, then reseed."}
              </p>
            ) : (
              <div className="comp-rows">
                {attPreview.map((r) => (
                  <div className="comp-att-row" key={r.student_id}>
                    <span className="comp-att-name">
                      <strong>
                        {r.students?.last_name}, {r.students?.first_name}
                      </strong>
                      {!canEditAttendance && (
                        <span className="muted"> · {r.status}</span>
                      )}
                    </span>
                    {canEditAttendance ? (
                      <form action={setAttendance} className="comp-att-toggle">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="competitionId" value={competitionId} />
                        <input type="hidden" name="studentId" value={r.student_id} />
                        <input
                          type="text"
                          name="note"
                          defaultValue={r.note ?? ""}
                          placeholder="Note"
                          aria-label={`Note for ${r.students?.first_name}`}
                          className="comp-att-note"
                        />
                        {ATT_TOGGLE.map((s) => (
                          <button
                            key={s.key}
                            type="submit"
                            name="status"
                            value={s.key}
                            className={`comp-toggle-btn ${s.key}${
                              r.status === s.key ? " active" : ""
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </form>
                    ) : (
                      r.note && <span className="muted">{r.note}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="comp-section-footer">
              <Link href={`${compBase}/attendance`}>
                All {attRows.length} student{attRows.length === 1 ? "" : "s"} →
              </Link>
              {canWrite && hasEnsembles && (
                <form action={reseedAttendance}>
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="competitionId" value={comp.id} />
                  <input type="hidden" name="seasonId" value={comp.season_id} />
                  <button type="submit" className="linklike">
                    Reseed attendance
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* ---- Volunteer shifts ---- */}
          {showShifts && (
            <section className="comp-section" id="shifts">
              <div className="comp-section-head">
                <h2>Volunteer shifts</h2>
                <Link href={`${base}/comms/shifts`}>Manage in Comms →</Link>
              </div>
              {shiftCards.length === 0 ? (
                <p className="muted">
                  No volunteer shifts attached to this competition yet.{" "}
                  <Link href={`${base}/comms/shifts`}>Add shifts →</Link>
                </p>
              ) : (
                <div className="comp-shift-grid">
                  {shiftCards.map((s) => {
                    const open = Math.max(0, s.needed - s.filled);
                    const pct = s.needed > 0 ? Math.round((s.filled / s.needed) * 100) : 100;
                    const full = open === 0;
                    const range = s.starts_at
                      ? `${formatTimeInTz(s.starts_at, tz)}${
                          s.ends_at ? ` – ${formatTimeInTz(s.ends_at, tz)}` : ""
                        }`
                      : "Time TBD";
                    return (
                      <div className="comp-shift-card" key={s.id}>
                        <strong className="comp-shift-title">{s.title}</strong>
                        <span className="comp-shift-time">{range}</span>
                        <div className="comp-progress">
                          <div
                            className={`comp-progress-fill ${full ? "ok" : "warn"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`comp-shift-count ${full ? "ok" : "warn"}`}>
                          {full
                            ? `Full (${s.filled} filled)`
                            : `${open} of ${s.needed} spot${s.needed === 1 ? "" : "s"} open`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ---- Meal count ---- */}
          <section className="comp-section" id="meals">
            <h2>Meal count</h2>
            <p className="comp-meal-rule">
              A meal is counted for every student marked <strong>expected</strong> or{" "}
              <strong>partial</strong>; only absent students are excluded.{" "}
              <a href={`/api/pdf/meal?competition=${competitionId}`}>
                Download meal count (PDF)
              </a>
            </p>
            <div className="comp-meal-figures">
              <span className="comp-meal-big">
                <span className="comp-meal-num">{meal?.totalAttending ?? 0}</span>{" "}
                <span className="muted">meals needed</span>
              </span>
              {(meal?.ensembles ?? []).map((e, i) => (
                <span key={i} className="comp-meal-ens">
                  {e.ensembleName} · <strong>{e.attending}</strong>{" "}
                  <span className="muted">({e.absent} absent)</span>
                </span>
              ))}
            </div>
            {meal?.mealNote && <p className="comp-meal-note muted">Note: {meal.mealNote}</p>}
          </section>

          {/* ---- Host packet ---- */}
          {showPacket && (
            <section className="comp-section" id="packet">
              <h2>Host packet</h2>
              {packet ? (
                <>
                  <div className="comp-packet-row">
                    <span className="comp-packet-file">
                      {packet.fileName} · uploaded{" "}
                      {formatDateInTz(packet.uploadedAt, tz)}
                    </span>
                    {packet.status &&
                      (() => {
                        const chip = PACKET_CHIP[packet.status];
                        return chip ? (
                          <span className={`comp-chip ${chip.tone}`}>{chip.label}</span>
                        ) : null;
                      })()}
                    <Link
                      href={
                        packet.parseId &&
                        (packet.status === "review" || packet.status === "accepted")
                          ? `${compBase}/packet/${packet.parseId}/review`
                          : `${compBase}/packet`
                      }
                    >
                      View / re-review
                    </Link>
                    {canWrite && (
                      <Link href={`${compBase}/packet`}>Upload another</Link>
                    )}
                  </div>
                  <p className="muted comp-caption">
                    AI drafts stay drafts — nothing lands on the itinerary until you
                    accept it.
                  </p>
                </>
              ) : (
                <p className="muted">
                  No host packet uploaded yet.
                  {canWrite && (
                    <>
                      {" "}
                      <Link href={`${compBase}/packet`}>Upload a packet →</Link>
                    </>
                  )}
                </p>
              )}
            </section>
          )}

          {/* ---- Results ---- */}
          <section className="comp-section" id="results">
            <h2>Results</h2>
            {comp.status !== "done" && !results ? (
              <p className="muted">
                Flip status to <strong>Done</strong> after the competition to record
                placement and captions — they land in the trophy case.
              </p>
            ) : canWrite ? (
              <form action={saveResults} className="stack">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="competitionId" value={comp.id} />
                <div className="row-inline">
                  <label>
                    Placement
                    <input
                      type="text"
                      name="placement"
                      defaultValue={results?.placement ?? ""}
                      placeholder="Grand Champion, 2nd Runner-Up…"
                    />
                  </label>
                  <label>
                    Division
                    <input type="text" name="division" defaultValue={results?.division ?? ""} />
                  </label>
                  <label>
                    Score
                    <input
                      type="number"
                      step="0.01"
                      name="score"
                      className="num"
                      defaultValue={results?.score ?? ""}
                    />
                  </label>
                </div>
                <fieldset className="stack">
                  <legend>Caption awards</legend>
                  <div className="row-inline">
                    {COMMON_CAPTIONS.map((name) => (
                      <label key={name} className="row-inline">
                        <input
                          type="checkbox"
                          name={`caption_${name}`}
                          defaultChecked={chosenCaptions.has(name)}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  <label>
                    Add more (comma-separated)
                    <input
                      type="text"
                      name="captions_extra"
                      placeholder="Best Ballad, Judges' Choice"
                    />
                  </label>
                </fieldset>
                <label>
                  Notes
                  <textarea name="notes" rows={2} defaultValue={results?.notes ?? ""} />
                </label>
                <button type="submit">Save results</button>
              </form>
            ) : results ? (
              <dl className="detail-list">
                <dt>Placement</dt>
                <dd>{results.placement ?? "—"}</dd>
                <dt>Score</dt>
                <dd>{results.score ?? "—"}</dd>
                <dt>Captions</dt>
                <dd>{activeCaptions(results.captions).join(", ") || "—"}</dd>
              </dl>
            ) : (
              <p className="muted">No results recorded.</p>
            )}
          </section>

          {/* ---- Edit details (disclosure target for the header action) ---- */}
          <section className="comp-section comp-details" id="details">
            <h2>Edit details</h2>
            {canWrite && ensembles.length === 0 ? (
              <p className="muted">
                A competition attaches to an ensemble so it can seed attendance,
                meals, and checkout.{" "}
                <Link href={`${base}/roster/ensembles`}>Create an ensemble first</Link>,
                then set it here.
              </p>
            ) : canWrite ? (
              <form action={updateCompetition} className="stack">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="competitionId" value={comp.id} />
                <input type="hidden" name="seasonId" value={comp.season_id} />
                <div className="row-inline">
                  <label>
                    Name
                    <input type="text" name="name" defaultValue={comp.name} required />
                  </label>
                  <label>
                    Date
                    <input type="date" name="date" defaultValue={comp.date ?? ""} />
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue={comp.status}>
                      <option value="planned">Planned</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="done">Done</option>
                    </select>
                  </label>
                </div>
                <fieldset className="stack">
                  <legend>Ensembles</legend>
                  <div className="row-inline" style={{ flexWrap: "wrap" }}>
                    {ensembles.map((e) => (
                      <label key={e.id} className="row-inline">
                        <input
                          type="checkbox"
                          name="ensemble_ids"
                          value={e.id}
                          defaultChecked={participatingEnsembleIds.includes(e.id)}
                        />
                        {e.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="row-inline">
                  <label>
                    Host school
                    <input type="text" name="host_school" defaultValue={comp.host_school ?? ""} />
                  </label>
                  <label>
                    Venue address
                    <input
                      type="text"
                      name="venue_address"
                      defaultValue={comp.venue_address ?? ""}
                    />
                  </label>
                  <label>
                    showchoir.com URL
                    <input
                      type="url"
                      name="showchoir_com_url"
                      defaultValue={comp.showchoir_com_url ?? ""}
                    />
                  </label>
                </div>
                <p className="muted">
                  Adding an ensemble seeds its members (expected). Removing one asks
                  for confirmation, then drops attendance and comp-scoped checkouts
                  only for students in no remaining ensemble.
                </p>
                <button type="submit">Save changes</button>
              </form>
            ) : (
              <dl className="detail-list">
                <dt>Date</dt>
                <dd>{comp.date ? formatDateInTz(`${comp.date}T12:00:00Z`, tz) : "—"}</dd>
                <dt>Host</dt>
                <dd>{comp.host_school ?? "—"}</dd>
                <dt>Venue</dt>
                <dd>{comp.venue_address ?? "—"}</dd>
                <dt>Status</dt>
                <dd>{COMPETITION_STATUS_LABELS[comp.status]}</dd>
              </dl>
            )}
          </section>
        </div>

        {/* ---- Right rail ---- */}
        <aside className="comp-rail">
          <div className="comp-card comp-readiness">
            <div className="comp-readiness-head">
              <h3>Readiness</h3>
              <span className="comp-readiness-score">
                {readiness.done} / {readiness.total}
              </span>
            </div>
            {readiness.checks.map((c, i) => (
              <Link
                className={`comp-readiness-row ${c.ok ? "" : c.tone}`}
                href={anchorFor(c.href)}
                key={i}
              >
                <span className={`status-dot ${c.tone}`} aria-hidden="true" />
                <span>{c.label}</span>
              </Link>
            ))}
          </div>

          <div className="comp-card">
            <h3>Papers &amp; links</h3>
            <a href={`/api/pdf/packet?competition=${competitionId}`}>Parent packet PDF ↓</a>
            <a href={`/api/pdf/meal?competition=${competitionId}`}>Meal count PDF ↓</a>
            <Link href={`${compBase}/itinerary`}>Itinerary share link →</Link>
            <p className="muted comp-caption">
              Parents see the published itinerary from their family link — no account
              needed.
            </p>
          </div>

          {showTravel && (
            <div className="comp-card">
              <h3>Travel</h3>
              {trip ? (
                <>
                  <div className="comp-travel-name">{trip.name}</div>
                  <div className="muted comp-travel-meta">
                    {trip.is_overnight ? "Overnight trip" : "Day trip"}
                    {trip.starts_on
                      ? ` · ${formatDateInTz(`${trip.starts_on}T12:00:00Z`, tz)}`
                      : ""}
                  </div>
                  <Link href={`${base}/travel/${trip.id}`}>Bus rosters →</Link>
                </>
              ) : (
                <p className="comp-travel-empty">
                  <span className="status-dot alert" aria-hidden="true" />
                  No trip yet — <Link href={`${base}/travel`}>create trip</Link>
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
