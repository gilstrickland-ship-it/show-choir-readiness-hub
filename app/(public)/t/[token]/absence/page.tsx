import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInTz, zonedDateKey } from "@/lib/datetime";
import { oneParam, type SearchParams } from "@/lib/flash";
import { parentSurfaceAvailable } from "@/lib/tokens";
import { TokenFooter, TokenUnavailable } from "../parts";
import { submitAbsence } from "./actions";

// Tokenized absence report (§8a) — guardian tokens ONLY. Pick own student +
// upcoming competition + optional note; submits a PENDING request to the staff
// review queue. Confirmation screen on submit. No-health label per Constitution
// III.
//
// Flag-gated on `competitions`, which is what the staff review queue
// (/competitions/absences) requires (Constitution VIII; rule in lib/tokens): a
// request submitted into a queue nobody can open is a parent believing they
// told the school their child would be away.

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
  note: string | null;
  student: { first_name: string; last_name: string } | null;
  competition: { name: string; date: string | null } | null;
}

// Status → the badge/chip class the card uses. Mirrors the mapping the table
// used: confirmed reads as a settled badge, dismissed as muted, pending as a chip.
const STATUS_CLASS: Record<RequestRow["status"], string> = {
  pending: "chip",
  confirmed: "badge",
  dismissed: "muted",
};

const STATUS_LABEL: Record<RequestRow["status"], string> = {
  pending: "Pending review",
  confirmed: "Confirmed",
  dismissed: "Not confirmed — student still expected",
};

export default async function PublicAbsencePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  // What Next actually hands back — `?s=a&s=b` arrives as an array, so the read
  // goes through oneParam and an array reads as absent.
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const s = oneParam(await searchParams, "s");
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();
  if (!parentSurfaceAvailable(resolved.program, "absence")) {
    return <TokenUnavailable token={token} resolved={resolved} />;
  }

  // Guardian tokens only — share links have no absence capability.
  if (resolved.kind !== "guardian") {
    return (
      <section className="stack">
        <h1>Report an absence</h1>
        <p className="muted">
          Absence reports need your family&apos;s personal link. Ask your director
          for it.
        </p>
        <TokenFooter token={token} resolved={resolved} />
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
        "id, status, created_at, note, student:students(first_name, last_name), competition:competitions(name, date)",
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
    // Competitions the family's ensembles participate in (Feature 004 junction).
    const { data: ceRows } = ensembleIds.length
      ? await supabase
          .from("competition_ensembles")
          .select("competition_id")
          .eq("program_id", program.id)
          .in("ensemble_id", ensembleIds)
      : { data: null };
    const familyCompIds = Array.from(
      new Set(
        ((ceRows as { competition_id: string }[] | null) ?? []).map(
          (r) => r.competition_id,
        ),
      ),
    );
    if (familyCompIds.length > 0) {
      const { data } = await supabase
        .from("competitions")
        .select("id, name, date")
        .eq("program_id", program.id)
        .eq("season_id", seasonId)
        .in("id", familyCompIds)
        // Program-tz today, not UTC's (Constitution VII) — a UTC key rolls over
        // at 7pm Central and would hide the competition a parent is reporting an
        // absence for on the evening before it.
        .gte("date", zonedDateKey(new Date(), tz))
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
          {/* Stacked cards, not a 4-column table — the parent surface is a phone
              screen, where a wide table squishes to unreadable (C2-4). */}
          <ul className="token-report-list">
            {requests.map((r) => (
              <li key={r.id} className="token-report-card">
                <div className="token-report-head">
                  <strong>
                    {r.student
                      ? `${r.student.first_name} ${r.student.last_name}`
                      : "—"}
                  </strong>
                  <span className={STATUS_CLASS[r.status]}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="muted">
                  {r.competition?.name ?? "—"}
                  {r.competition?.date
                    ? ` · ${formatDateInTz(`${r.competition.date}T12:00:00Z`, tz)}`
                    : ""}
                </div>
                <div className="token-report-meta">
                  Submitted {formatDateInTz(r.created_at, tz)}
                </div>
                {r.note && <p className="token-report-note">{r.note}</p>}
              </li>
            ))}
          </ul>
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
          {/* Each label spans the column. `.stack` aligns items to flex-start, so
              an auto-width label shrink-wraps its widest child — and a <select>
              is as wide as its longest option, which is a competition name. That
              pushed the whole page 15px sideways at 375px (measured), the one
              width this surface exists for. A definite width lets the select's
              own max-width:100% finally bite. */}
          <label style={{ width: "100%" }}>
            Student
            <select name="studentId" required>
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.first_name} {st.last_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ width: "100%" }}>
            Competition
            <select name="competitionId" required>
              {comps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.date ? ` — ${formatDateInTz(`${c.date}T12:00:00Z`, tz)}` : ""}
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

      <TokenFooter token={token} resolved={resolved} />
    </section>
  );
}
