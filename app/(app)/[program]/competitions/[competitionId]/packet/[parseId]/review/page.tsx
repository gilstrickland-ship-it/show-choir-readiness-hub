import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES, ITINERARY_ITEM_KINDS } from "@/lib/competitions";
import { CompetitionTabs } from "../../../CompetitionTabs";
import { acceptParse } from "./actions";
import { formatTimeZoneLabel } from "@/lib/datetime";

// Packet parse review screen (§5 step 5, T015). Source document on the left,
// editable parsed items + ambiguities/issues on the right. Accept materializes
// items into the draft itinerary (source='parsed') for further manual editing;
// nothing auto-publishes (Constitution IV).

interface ParseRow {
  id: string;
  document_id: string;
  status: "queued" | "running" | "review" | "accepted" | "failed";
  error: string | null;
  raw_output: {
    parsed?: {
      competition?: { perform_time?: string | null; homeroom?: string | null; awards_time?: string | null };
      items?: Array<{
        starts_at?: string | null;
        ends_at?: string | null;
        kind: string;
        title: string;
        location?: string | null;
        details?: string | null;
      }>;
      ambiguities?: string[];
    };
    issues?: string[];
  } | null;
}

// datetime-local wants exactly "YYYY-MM-DDTHH:MM".
function toInput(wall: string | null | undefined): string {
  if (!wall) return "";
  const m = wall.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
  return m ? m[0].replace(" ", "T") : "";
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ program: string; competitionId: string; parseId: string }>;
}) {
  const { program: slug, competitionId, parseId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  requireFlag(program, "packet_parse");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;

  const supabase = await createClient();
  const { data: parseData } = await supabase
    .from("packet_parses")
    .select("id, document_id, status, error, raw_output")
    .eq("id", parseId)
    .eq("program_id", program.id)
    .maybeSingle();
  const parse = parseData as ParseRow | null;
  if (!parse) notFound();

  const parsed = parse.raw_output?.parsed;
  const items = parsed?.items ?? [];
  const ambiguities = parsed?.ambiguities ?? [];
  const issues = parse.raw_output?.issues ?? [];

  // Signed URL for the source document.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", parse.document_id)
    .maybeSingle();
  let signedUrl: string | null = null;
  const path = (doc as { storage_path: string } | null)?.storage_path;
  if (path) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 3600);
    signedUrl = signed?.signedUrl ?? null;
  }

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/competitions/${competitionId}/packet`}>← Packet</Link>
      </p>
      <CompetitionTabs slug={slug} competitionId={competitionId} active="packet" />
      <h1>Review parsed packet</h1>
      <p className="muted">
        AI-drafted from the host packet. Nothing here reaches a parent until you
        accept it here and then publish the itinerary. Times are shown in{" "}
        {formatTimeZoneLabel(tz)}.
      </p>

      {parsed?.competition && (
        <p className="muted">
          Detected: perform {parsed.competition.perform_time ?? "—"} · homeroom{" "}
          {parsed.competition.homeroom ?? "—"} · awards {parsed.competition.awards_time ?? "—"}
        </p>
      )}

      {(ambiguities.length > 0 || issues.length > 0) && (
        <div className="confirm-box stack">
          <strong>Flagged for your review</strong>
          <ul>
            {issues.map((s, i) => (
              <li key={`issue-${i}`}>{s}</li>
            ))}
            {ambiguities.map((s, i) => (
              <li key={`amb-${i}`} className="muted">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", width: "100%" }}>
        {/* ---- Source document ---- */}
        {signedUrl && (
          <div style={{ flex: "1 1 20rem", minWidth: "16rem" }}>
            <h2>Source</h2>
            <object
              data={signedUrl}
              type="application/pdf"
              width="100%"
              height="640"
              style={{ border: "1px solid var(--border)", borderRadius: 8 }}
            >
              <p className="muted">
                <a href={signedUrl}>Open the uploaded packet</a>
              </p>
            </object>
          </div>
        )}

        {/* ---- Editable parsed items ---- */}
        <div style={{ flex: "1 1 24rem", minWidth: "18rem" }} className="stack">
          <h2>Parsed items</h2>
          {items.length === 0 && <p className="muted">No items were extracted.</p>}
          {canWrite ? (
            <form action={acceptParse} className="stack">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="competitionId" value={competitionId} />
              <input type="hidden" name="parseId" value={parseId} />
              <input type="hidden" name="tz" value={tz} />
              <input type="hidden" name="count" value={items.length} />
              {items.map((item, i) => (
                <fieldset key={i} className="stack">
                  <legend>
                    <label className="row-inline">
                      <input
                        type="checkbox"
                        name={`item_${i}_include`}
                        value="1"
                        defaultChecked
                      />
                      Include
                    </label>
                  </legend>
                  <div className="row-inline">
                    <label>
                      Kind
                      <select name={`item_${i}_kind`} defaultValue={
                        (ITINERARY_ITEM_KINDS as readonly string[]).includes(item.kind)
                          ? item.kind
                          : "other"
                      }>
                        {ITINERARY_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Starts
                      <input
                        type="datetime-local"
                        name={`item_${i}_starts_at`}
                        defaultValue={toInput(item.starts_at)}
                      />
                    </label>
                    <label>
                      Ends
                      <input
                        type="datetime-local"
                        name={`item_${i}_ends_at`}
                        defaultValue={toInput(item.ends_at)}
                      />
                    </label>
                  </div>
                  <div className="row-inline">
                    <label>
                      Title
                      <input type="text" name={`item_${i}_title`} defaultValue={item.title ?? ""} />
                    </label>
                    <label>
                      Location
                      <input
                        type="text"
                        name={`item_${i}_location`}
                        defaultValue={item.location ?? ""}
                      />
                    </label>
                    <label>
                      Details
                      <input
                        type="text"
                        name={`item_${i}_details`}
                        defaultValue={item.details ?? ""}
                      />
                    </label>
                  </div>
                </fieldset>
              ))}
              <p className="muted">
                Accepting replaces the draft itinerary&apos;s items with these. You
                can keep editing on the Itinerary tab, then publish there.
              </p>
              <button type="submit">Accept into draft itinerary</button>
            </form>
          ) : (
            <p className="muted">Read-only — a director or admin can accept this draft.</p>
          )}
        </div>
      </div>
    </section>
  );
}
