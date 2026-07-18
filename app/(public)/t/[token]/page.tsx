import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz } from "@/lib/datetime";
import { TokenFooter } from "./parts";

// Guardian-token home — the family view (§8a). Shows the family's students, the
// next competition with a published itinerary, and each student's costume
// assignment + alteration status (allow-listed read: 'costume:view'). Share
// tokens land here in read-only browse mode.

const ALTERATION_LABEL: Record<string, string> = {
  none: "No alterations",
  needed: "Alteration needed",
  in_progress: "Alteration in progress",
  done: "Alterations done",
};

interface AssignmentRow {
  student_id: string;
  alteration_status: string;
  alteration_notes: string | null;
  piece: { label: string | null; kind: string } | null;
}

export default async function TokenHomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  if (resolved.kind === "share") {
    return (
      <section className="stack">
        <h1>Welcome</h1>
        <p>
          This is a shared, read-only link for {resolved.program.name}. Use the
          links below to view the itinerary and volunteer signup.
        </p>
        <TokenFooter token={token} kind="share" />
      </section>
    );
  }

  const { program, students } = resolved;
  const tz = program.timezone;
  const supabase = createAdminClient();

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

  // Next upcoming competition for the family's ensembles with a published
  // itinerary.
  const todayKey = formatIsoDate(new Date());
  let nextComp: {
    id: string;
    name: string;
    date: string | null;
    itineraryPublished: boolean;
  } | null = null;

  if (seasonId && studentIds.length > 0) {
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("ensemble_id")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .in("student_id", studentIds);
    const ensembleIds = Array.from(
      new Set(((mems as { ensemble_id: string }[] | null) ?? []).map((m) => m.ensemble_id)),
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
      const comp = ((comps as { id: string; name: string; date: string | null }[] | null) ?? [])[0];
      if (comp) {
        const { data: itin } = await supabase
          .from("itineraries")
          .select("status")
          .eq("program_id", program.id)
          .eq("competition_id", comp.id)
          .maybeSingle();
        nextComp = {
          ...comp,
          itineraryPublished: (itin as { status: string } | null)?.status === "published",
        };
      }
    }
  }

  return (
    <section className="stack">
      <h1>Your family</h1>

      {nextComp && (
        <div className="confirm-box" style={{ width: "100%" }}>
          <strong>Next competition:</strong> {nextComp.name}
          {nextComp.date && <> — {formatDateInTz(nextComp.date, tz)}</>}
          <div style={{ marginTop: "0.5rem" }}>
            {nextComp.itineraryPublished ? (
              <Link href={`/t/${token}/itinerary`}>View the itinerary →</Link>
            ) : (
              <span className="muted">Itinerary not published yet.</span>
            )}
          </div>
        </div>
      )}

      {students.length === 0 && <p className="muted">No students on file.</p>}

      {students.map((student) => {
        const rows = assignmentsByStudent.get(student.id) ?? [];
        return (
          <div key={student.id} style={{ width: "100%" }}>
            <h2>
              {student.first_name} {student.last_name}
            </h2>
            {rows.length === 0 ? (
              <p className="muted">No costume assignments yet.</p>
            ) : (
              <ul>
                {rows.map((r, i) => (
                  <li key={i}>
                    {r.piece?.label ?? "Costume piece"}
                    {" — "}
                    <span
                      className={
                        r.alteration_status === "needed" ||
                        r.alteration_status === "in_progress"
                          ? "danger"
                          : "muted"
                      }
                    >
                      {ALTERATION_LABEL[r.alteration_status] ?? r.alteration_status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <p className="muted">
        Volunteer signups and absence reports are in the links below.
      </p>

      <TokenFooter token={token} kind="guardian" />
    </section>
  );
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
