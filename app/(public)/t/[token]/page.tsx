import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz, formatTimeInTz, zonedWallToUtc } from "@/lib/datetime";
import { itineraryAnchors } from "@/lib/itinerary-days";
import { TokenFooter } from "./parts";

// Guardian-token home — the family "poster" (§8a, §10). A dark hero counts down
// to the family's next competition (call/return + itinerary + packet, all gated
// behind the published invariant §9.3 — a draft itinerary is NEVER surfaced
// here), per-student costume cards show each assignment's alteration status
// (allow-listed read: 'costume:view'), and a volunteer nudge points at the
// signup page when shifts are open. Share tokens land in a read-only browse mode.
// SECURITY: the token capability model (lib/tokens.ts) is unchanged — the packet
// button rides the existing published-only /packet route, the absence link is
// guardian-only (TokenFooter), and no new PII beyond costume piece labels/status
// is read.

const ALTERATION_LABEL: Record<string, string> = {
  none: "No alterations",
  needed: "Alteration needed",
  in_progress: "Alteration in progress",
  done: "Alterations done",
};

// Alteration statuses that read as "needs attention" (red dot) on the family
// poster — everything else is a settled/green row.
const ALTERATION_OPEN = new Set(["needed", "in_progress"]);

interface AssignmentRow {
  student_id: string;
  alteration_status: string;
  alteration_notes: string | null;
  piece: { label: string | null; kind: string } | null;
}

// Whole days from now to a zoned midnight date (future). Past/today clamp to 0.
function daysUntil(dateKey: string, tz: string): number | null {
  const target = zonedWallToUtc(`${dateKey}T00:00`, tz);
  if (!target || Number.isNaN(target.getTime())) return null;
  const ms = target.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

export default async function TokenHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  if (resolved.kind === "share") {
    return (
      <section className="stack token-poster">
        <div className="token-share-card">
          <h1>Welcome</h1>
          <p>
            This is a shared, read-only link for {resolved.program.name}. Use
            the links below to view the itinerary and volunteer signup.
          </p>
        </div>
        <TokenFooter token={token} kind="share" />
      </section>
    );
  }

  const { program, students, guardian } = resolved;
  const tz = program.timezone;
  const supabase = createAdminClient();

  // Parent welcome card (spec 003 §4) — a friendly hello on a family's first
  // couple of visits, then it quietly disappears. "First visits" is derived from
  // the token_events audit trail (reads only, no schema, no client state): count
  // this family's guardian-token 'view' rows. The layout logs THIS visit before
  // the page renders, so the count already includes it — show the card at ≤ 3.
  // The footer's "How this page works" link force-shows it any time via ?welcome=1.
  let showWelcome = sp.welcome === "1";
  if (!showWelcome) {
    // The family's guardian rows (siblings share an email), then their tokens.
    let guardianIds = [guardian.id];
    if (guardian.email) {
      const { data: fam } = await supabase
        .from("guardians")
        .select("id")
        .eq("program_id", program.id)
        .eq("email", guardian.email);
      const ids = ((fam as { id: string }[] | null) ?? []).map((g) => g.id);
      if (ids.length > 0) guardianIds = ids;
    }
    const { data: toks } = await supabase
      .from("guardian_tokens")
      .select("id")
      .eq("program_id", program.id)
      .in("guardian_id", guardianIds);
    const tokenIds = ((toks as { id: string }[] | null) ?? []).map((t) => t.id);
    if (tokenIds.length > 0) {
      const { count } = await supabase
        .from("token_events")
        .select("id", { count: "exact", head: true })
        .eq("program_id", program.id)
        .eq("token_kind", "guardian")
        .eq("action", "view")
        .in("token_id", tokenIds);
      showWelcome = (count ?? 0) <= 3;
    } else {
      showWelcome = true;
    }
  }

  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", program.id)
    .eq("is_active", true)
    .maybeSingle();
  const seasonId = (season as { id: string } | null)?.id ?? null;

  const studentIds = students.map((s) => s.id);

  // Costume assignments (active season) + piece label per student.
  const assignmentsByStudent = new Map<string, AssignmentRow[]>();
  if (seasonId && studentIds.length > 0) {
    const { data: asgn } = await supabase
      .from("costume_assignments")
      .select(
        "student_id, alteration_status, alteration_notes, piece:costume_pieces(label, kind)",
      )
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .in("student_id", studentIds);
    for (const a of (asgn as unknown as AssignmentRow[] | null) ?? []) {
      const list = assignmentsByStudent.get(a.student_id) ?? [];
      list.push(a);
      assignmentsByStudent.set(a.student_id, list);
    }
  }

  // Next upcoming competition for the family's ensembles.
  const todayKey = formatIsoDate(new Date());
  let nextComp: {
    id: string;
    name: string;
    date: string | null;
    itineraryPublished: boolean;
    callTime: string | null;
    returnTime: string | null;
  } | null = null;
  let openShiftSlots = 0;

  if (seasonId && studentIds.length > 0) {
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .in("student_id", studentIds);
    const ensembleIds = Array.from(
      new Set(
        ((mems as { ensemble_id: string }[] | null) ?? []).map(
          (m) => m.ensemble_id,
        ),
      ),
    );

    if (ensembleIds.length > 0) {
      const { data: comps } = await supabase
        .from("competitions")
        .select("id, name, date")
        .eq("program_id", program.id)
        .eq("season_id", seasonId)
        .in("ensemble_id", ensembleIds)
        .gte("date", todayKey)
        .order("date", { ascending: true })
        .limit(1);
      const comp = ((comps as
        { id: string; name: string; date: string | null }[] | null) ?? [])[0];
      if (comp) {
        // Published-only invariant (§9.3): the itinerary status decides whether
        // itinerary/packet/call-time surface at all — a draft never leaks here.
        const { data: itin } = await supabase
          .from("itineraries")
          .select("id, status")
          .eq("program_id", program.id)
          .eq("competition_id", comp.id)
          .maybeSingle();
        const itinRow = itin as { id: string; status: string } | null;
        const published = itinRow?.status === "published";

        let callTime: string | null = null;
        let returnTime: string | null = null;
        if (published && itinRow) {
          const { data: items } = await supabase
            .from("itinerary_items")
            .select("starts_at, ends_at, kind")
            .eq("program_id", program.id)
            .eq("itinerary_id", itinRow.id)
            .order("starts_at", { ascending: true });
          const rows =
            (items as
              | {
                  starts_at: string | null;
                  ends_at: string | null;
                  kind: string;
                }[]
              | null) ?? [];
          // "home ~X" only shows with a real end anchor — see itineraryAnchors.
          const anchors = itineraryAnchors(rows);
          callTime = anchors.callTime;
          returnTime = anchors.homeEstimate;
        }

        nextComp = {
          id: comp.id,
          name: comp.name,
          date: comp.date,
          itineraryPublished: published,
          callTime,
          returnTime,
        };
      }

      // Volunteer nudge — open slots on this season's shifts (empty when the
      // shifts feature is off, so no nudge shows). No new capability: shift data
      // is already the parent signup surface.
      const { data: shiftRows } = await supabase
        .from("shifts")
        .select("id, needed_count")
        .eq("program_id", program.id)
        .eq("season_id", seasonId);
      const shifts =
        (shiftRows as { id: string; needed_count: number }[] | null) ?? [];
      if (shifts.length > 0) {
        const { data: suRows } = await supabase
          .from("shift_signups")
          .select("shift_id, status")
          .eq("program_id", program.id)
          .in(
            "shift_id",
            shifts.map((s) => s.id),
          )
          .eq("status", "confirmed");
        const confirmed = new Map<string, number>();
        for (const su of (suRows as { shift_id: string }[] | null) ?? []) {
          confirmed.set(su.shift_id, (confirmed.get(su.shift_id) ?? 0) + 1);
        }
        openShiftSlots = shifts.reduce(
          (sum, s) =>
            sum + Math.max(0, s.needed_count - (confirmed.get(s.id) ?? 0)),
          0,
        );
      }
    }
  }

  const days = nextComp?.date ? daysUntil(nextComp.date, tz) : null;

  return (
    <section className="stack token-poster">
      {showWelcome && (
        <section className="token-welcome-card">
          <h2>Welcome</h2>
          <p>
            This page is your family&apos;s — bookmark it, it works all season.
          </p>
          <p>
            The links at the bottom do three things: see the times, sign up to
            help, and report an absence.
          </p>
          <p>
            Everything also arrives by email. The links in your newest email
            always work.
          </p>
        </section>
      )}

      {nextComp && (
        <section className="token-hero">
          <p className="token-hero-kicker">Next competition</p>
          {days !== null && (
            <div className="token-hero-count">
              <span className="token-hero-days">{days}</span>
              <span className="token-hero-unit">
                {days === 1 ? "day" : "days"}
              </span>
            </div>
          )}
          <div className="token-hero-name">{nextComp.name}</div>
          <p className="token-hero-meta">
            {nextComp.date && formatDateInTz(`${nextComp.date}T12:00:00Z`, tz)}
            {nextComp.itineraryPublished && nextComp.callTime && (
              <> · call {formatTimeInTz(nextComp.callTime, tz)}</>
            )}
            {nextComp.itineraryPublished && nextComp.returnTime && (
              <> · home ~{formatTimeInTz(nextComp.returnTime, tz)}</>
            )}
          </p>
          {/* Itinerary + packet appear ONLY when the itinerary is published
              (invariant §9.3) — the packet route re-checks and 409s otherwise. */}
          {nextComp.itineraryPublished && (
            <div className="token-hero-actions">
              <Link href={`/t/${token}/itinerary`} className="token-btn accent">
                View the itinerary
              </Link>
              <a
                href={`/t/${token}/packet?competition=${nextComp.id}`}
                className="token-btn ghost"
              >
                Download packet (PDF)
              </a>
            </div>
          )}
          {!nextComp.itineraryPublished && (
            <p className="token-hero-pending">Itinerary not published yet.</p>
          )}
        </section>
      )}

      {students.length === 0 && <p className="muted">No students on file.</p>}

      {students.map((student) => {
        const rows = assignmentsByStudent.get(student.id) ?? [];
        return (
          <section key={student.id} className="token-student-card">
            <h2>
              {student.first_name} {student.last_name}
            </h2>
            {rows.length === 0 ? (
              <p className="token-student-empty">No costume assignments yet.</p>
            ) : (
              rows.map((r, i) => {
                const open = ALTERATION_OPEN.has(r.alteration_status);
                return (
                  <div key={i} className="token-costume-row">
                    <span className={`status-dot ${open ? "alert" : "ok"}`} />
                    <span className="token-costume-label">
                      {r.piece?.label ?? "Costume piece"} —{" "}
                      <strong className={open ? "danger" : "token-ok"}>
                        {ALTERATION_LABEL[r.alteration_status] ??
                          r.alteration_status}
                      </strong>
                    </span>
                  </div>
                );
              })
            )}
          </section>
        );
      })}

      {openShiftSlots > 0 && (
        <section className="token-nudge">
          <h2>Volunteers needed</h2>
          <p>
            {openShiftSlots} spot{openShiftSlots === 1 ? "" : "s"} still open
            this season — chaperones and helpers.
          </p>
          <Link href={`/t/${token}/signup`} className="token-btn dark">
            See open shifts
          </Link>
        </section>
      )}

      <TokenFooter token={token} kind="guardian" />
    </section>
  );
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
