import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz } from "@/lib/datetime";
import { TokenFooter } from "../parts";
import { submitAbsence } from "./actions";

// Tokenized absence report (§8a) — guardian tokens ONLY. Pick own student +
// upcoming competition + optional note; submits a PENDING request to the staff
// review queue. Confirmation screen on submit. No-health label per Constitution
// III.

const NO_HEALTH_LABEL = "Do not enter health or medical information.";

interface CompRow {
  id: string;
  name: string;
  date: string | null;
}

interface RequestRow {
  id: string;
  status: "pending" | "confirmed" | "dismissed";
  created_at: string;
  student: { first_name: string; last_name: string } | null;
  competition: { name: string; date: string | null } | null;
}

const STATUS_LABEL: Record<RequestRow["status"], string> = {
  pending: "Pending review",
  confirmed: "Confirmed",
  dismissed: "Not approved",
};

export default async function PublicAbsencePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { token } = await params;
  const { s } = await searchParams;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  // Guardian tokens only — share links have no absence capability.
  if (resolved.kind !== "guardian") {
    return (
      <section className="stack">
        <h1>Report an absence</h1>
        <p className="muted">
          Absence reports need your family&apos;s personal link. Ask your director
          for it.
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
  const studentIds = students.map((st) => st.id);

  // This family's recent absence requests (own students only — scoped by the
  // family's student ids on the service-role client). Lets a parent see the
  // round-trip status and avoid double-submitting (F16).
  let requests: RequestRow[] = [];
  if (studentIds.length > 0) {
    const { data: reqData } = await supabase
      .from("absence_requests")
      .select(
        "id, status, created_at, student:students(first_name, last_name), competition:competitions(name, date)",
      )
      .eq("program_id", program.id)
      .in("student_id", studentIds)
      .order("created_at", { ascending: false })
      .limit(10);
    requests = (reqData as unknown as RequestRow[] | null) ?? [];
  }

  // Upcoming competitions for the family's ensembles.
  let comps: CompRow[] = [];
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
      const { data } = await supabase
        .from("competitions")
        .select("id, name, date")
        .eq("program_id", program.id)
        .eq("season_id", seasonId)
        .in("ensemble_id", ensembleIds)
        .gte("date", new Date().toISOString().slice(0, 10))
        .order("date", { ascending: true });
      comps = (data as CompRow[] | null) ?? [];
    }
  }

  const message =
    s === "invalid"
      ? "That selection was not valid. Please try again."
      : s === "ratelimited"
        ? "Too many requests — please wait a moment."
        : s === "error"
          ? "Something went wrong. Please try again."
          : null;

  return (
    <section className="stack">
      <h1>Report an absence</h1>
      {s === "submitted" && (
        <p className="alert-ok">
          Thank you — your absence report was sent to the staff for review. It is
          listed below as “Pending review” until they confirm it.
        </p>
      )}
      {message && <p className="alert-error">{message}</p>}

      {requests.length > 0 && (
        <div style={{ width: "100%" }}>
          <h2>Your recent absence reports</h2>
          <p className="muted">
            Check here before submitting again — a report already listed does not
            need to be sent twice.
          </p>
          <table className="members">
            <thead>
              <tr>
                <th>Student</th>
                <th>Competition</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.student
                      ? `${r.student.first_name} ${r.student.last_name}`
                      : "—"}
                  </td>
                  <td>{r.competition?.name ?? "—"}</td>
                  <td>{formatDateInTz(r.created_at, tz)}</td>
                  <td>
                    <span
                      className={
                        r.status === "confirmed"
                          ? "badge"
                          : r.status === "dismissed"
                            ? "muted"
                            : "chip"
                      }
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Report a new absence</h2>
      {students.length === 0 || comps.length === 0 ? (
        <p className="muted">
          There are no upcoming competitions to report an absence for right now.
        </p>
      ) : (
        <form action={submitAbsence} className="stack" style={{ width: "100%" }}>
          <input type="hidden" name="token" value={token} />
          <label>
            Student
            <select name="studentId" required>
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.first_name} {st.last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Competition
            <select name="competitionId" required>
              {comps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.date ? ` — ${formatDateInTz(c.date, tz)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={{ width: "100%" }}>
            Note (optional)
            <textarea name="note" rows={3} />
          </label>
          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">Submit absence report</button>
        </form>
      )}

      <TokenFooter token={token} kind="guardian" />
    </section>
  );
}
