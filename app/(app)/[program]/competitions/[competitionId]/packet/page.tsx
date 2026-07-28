import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { formatDateTimeInTz } from "@/lib/datetime";
import { CompetitionTabs } from "../CompetitionTabs";
import { PacketPipeline } from "../PacketPipeline";
import { loadPacketPipeline, packetPipelineSteps } from "@/lib/packet-pipeline";
import { uploadPacket, reparsePacket, runParseNow } from "./actions";

// A queued/running parse older than this is treated as stuck — the inline worker
// or Inngest never carried it to a terminal state (F7).
const STUCK_AFTER_MS = 2 * 60 * 1000;

function isStuck(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > STUCK_AFTER_MS;
}

// Map known parse-failure strings to guidance (F8b). The AI client throws the
// literal "ANTHROPIC_API_KEY is not set" when the deployment has no key; every
// other failure (bad JSON, download errors) gets a plain-language sentence with
// the raw detail tucked into a collapsible block so support can still see it.
function friendlyParseError(raw: string): { message: string; detail?: string } {
  if (raw.includes("ANTHROPIC_API_KEY is not set")) {
    return {
      message:
        "Automatic reading isn't set up for this deployment — enter the itinerary by hand.",
    };
  }
  return {
    message:
      "The upload couldn't be read automatically. You can try again, or enter the itinerary by hand — the PDF stays available either way.",
    detail: raw,
  };
}

// Packet tab (§5, T015). Upload a host packet (PDF/image); when the packet_parse
// flag is on, an AI draft parse runs and lands in a review screen (draft-only,
// Constitution IV). A failed or flag-off state degrades to the manual itinerary
// editor with the document shown alongside (T014).

interface DocRow {
  id: string;
  storage_path: string;
  created_at: string;
}

interface ParseRow {
  id: string;
  document_id: string;
  status: "queued" | "running" | "review" | "accepted" | "failed";
  error: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running…",
  review: "Ready to review",
  accepted: "Accepted",
  failed: "Failed",
};

export default async function PacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<{ uploaded?: string; error?: string }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role, flags } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const parseEnabled = flags.packet_parse;
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("id", competitionId)
    .eq("program_id", program.id)
    .maybeSingle();
  const comp = compData as { id: string; name: string } | null;
  if (!comp) notFound();

  const { data: docData } = await supabase
    .from("documents")
    .select("id, storage_path, created_at")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .eq("kind", "host_packet")
    .order("created_at", { ascending: false });
  const docs = (docData as DocRow[] | null) ?? [];

  const { data: parseData } = await supabase
    .from("packet_parses")
    .select("id, document_id, status, error, created_at")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .order("created_at", { ascending: false });
  const parses = (parseData as ParseRow[] | null) ?? [];
  const parseByDoc = new Map<string, ParseRow>();
  for (const p of parses) {
    if (!parseByDoc.has(p.document_id)) parseByDoc.set(p.document_id, p);
  }

  // Where this packet is in the five steps (US7-4). Only when parsing is on —
  // with the flag off there is no parse/review half of the pipeline to show.
  const pipeline = parseEnabled
    ? packetPipelineSteps(
        await loadPacketPipeline(supabase, {
          programId: program.id,
          competitionId,
        }),
        `/${slug}/competitions/${competitionId}`,
      )
    : null;

  return (
    <section className="stack">
      <CompetitionTabs slug={slug} competitionId={competitionId} active="packet" />
      <h1>Host packet</h1>
      {pipeline && <PacketPipeline steps={pipeline} />}

      {sp.uploaded && (
        <p className="alert-ok">
          Uploaded.{" "}
          {parseEnabled ? "Parsing started — check back for the review screen." : ""}
        </p>
      )}
      {sp.error === "file" && <p className="alert-error">Choose a file to upload.</p>}
      {sp.error === "type" && (
        <p className="alert-error">Only PDF or image files (PNG/JPEG/WebP/GIF).</p>
      )}
      {sp.error === "upload" && <p className="alert-error">Upload failed. Try again.</p>}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t record the document.</p>}
      {sp.error === "parse" && (
        <p className="alert-error">
          That parse doesn&apos;t belong to this competition, so it wasn&apos;t run.
        </p>
      )}

      {!parseEnabled && (
        <p className="muted">
          AI packet parsing is off for this program. Uploaded packets show alongside
          the{" "}
          <Link href={`/${slug}/competitions/${competitionId}/itinerary`}>manual editor</Link>.
        </p>
      )}

      {canWrite && (
        <form action={uploadPacket} className="stack">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <label>
            Packet file (PDF or image)
            <input type="file" name="file" accept="application/pdf,image/*" required />
          </label>
          <button type="submit">Upload packet</button>
        </form>
      )}

      <h2>Uploaded packets</h2>
      <table className="members">
        <thead>
          <tr>
            <th>Uploaded</th>
            <th>Parse status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const p = parseByDoc.get(d.id);
            return (
              <tr key={d.id}>
                <td>{formatDateTimeInTz(d.created_at, program.timezone)}</td>
                <td>
                  {p ? (
                    <span className="badge">{STATUS_LABEL[p.status]}</span>
                  ) : (
                    <span className="muted">no parse</span>
                  )}
                  {p?.status === "failed" && p.error
                    ? (() => {
                        const fe = friendlyParseError(p.error);
                        return (
                          <div className="muted">
                            {fe.message}
                            {fe.detail ? (
                              <details>
                                <summary>Technical details</summary>
                                {fe.detail}
                              </details>
                            ) : null}
                          </div>
                        );
                      })()
                    : null}
                </td>
                <td>
                  {p && (p.status === "review" || p.status === "accepted") && (
                    <Link
                      href={`/${slug}/competitions/${competitionId}/packet/${p.id}/review`}
                    >
                      {p.status === "review" ? "Review draft" : "View / re-review"}
                    </Link>
                  )}
                  {p && (p.status === "queued" || p.status === "running") && (
                    isStuck(p.created_at) ? (
                      canWrite && (
                        <form action={runParseNow} style={{ display: "inline" }}>
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="competitionId" value={competitionId} />
                          <input type="hidden" name="parseId" value={p.id} />
                          <button type="submit" className="linklike">
                            Run parse now
                          </button>
                        </form>
                      )
                    ) : (
                      <span className="muted">Parsing — refresh in a moment.</span>
                    )
                  )}
                  {p && p.status === "failed" && canWrite && (
                    <form action={reparsePacket} style={{ display: "inline" }}>
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <input type="hidden" name="parseId" value={p.id} />
                      <button type="submit" className="linklike">
                        Try again
                      </button>
                    </form>
                  )}
                  {/* Manual fallback stays available for any not-yet-accepted parse. */}
                  {p && p.status !== "accepted" && (
                    <Link
                      href={`/${slug}/competitions/${competitionId}/itinerary`}
                      style={{ marginLeft: "0.5rem" }}
                    >
                      Enter manually
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          {docs.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No packets uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
