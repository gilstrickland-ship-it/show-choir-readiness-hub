import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  ITINERARY_ITEM_KINDS,
} from "@/lib/competitions";
import { SubTabs } from "../../../../../SubTabs";
import { competitionTabs } from "@/lib/subnav";
import { PacketPipeline } from "../../../PacketPipeline";
import { IntroStrip, HelpDot } from "../../../../../IntroStrip";
import { loadGuideState } from "@/lib/guide";
import { loadPacketPipeline, packetPipelineSteps } from "@/lib/packet-pipeline";
import { acceptParse } from "./actions";
import { ACCEPT_LIVE_CONFIRM, REVIEW_FLASH_MAPS } from "./shared";
import { readFlash } from "@/lib/flash";
import { formatTimeZoneLabel } from "@/lib/datetime";

// Packet parse review screen (§5 step 5, T015). Source document on the left,
// editable parsed items + ambiguities/issues on the right. Accept materializes
// items into the itinerary (source='parsed') for further manual editing.
//
// WHAT THIS SCREEN PROMISES HAS TO BE TRUE IN BOTH STATES. It used to say, in
// every case, "Nothing here reaches a parent until you accept it here and then
// publish the itinerary" — which is exactly right for a draft and false for a
// competition whose itinerary is already published, where accepting replaces
// what families are reading in one click. The screen reads the itinerary's
// status now and says whichever of the two things is true, and the live case
// asks for an explicit confirm before the button will do anything (the action
// requires it too — Constitution IV, a human approves what they are seeing).

interface ParseRow {
  id: string;
  document_id: string;
  status: "queued" | "running" | "review" | "accepted" | "failed";
  error: string | null;
  raw_output: {
    parsed?: {
      competition?: {
        perform_time?: string | null;
        homeroom?: string | null;
        awards_time?: string | null;
      };
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
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string; parseId: string }>;
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // lib/flash — a hand-typed `?error=constructor` must resolve to nothing.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, competitionId, parseId } = await params;
  const { program, role, flags, membership, isSupport } =
    await getTenantContext(slug);
  requireFlag(program, "competitions");
  requireFlag(program, "packet_parse");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
  const sp = await searchParams;
  const flash = readFlash(sp, REVIEW_FLASH_MAPS);
  const showHelp = sp.help === "1";

  const supabase = await createClient();

  // First-use intro strip (spec 003 §3) — the AI drafted these; a human accepts.
  const showGuide = flags.guide && !isSupport && !!membership.user_id;
  const guideState =
    showGuide && membership.user_id
      ? await loadGuideState(supabase, program.id, membership.user_id)
      : {};
  // Scoped to the program AND to the competition in the URL: a parse row only
  // ever reviews its own competition's packet, so a row pointing somewhere else
  // renders nowhere rather than under whichever competition was asked for.
  const { data: parseData } = await supabase
    .from("packet_parses")
    .select("id, document_id, status, error, raw_output")
    .eq("id", parseId)
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const parse = parseData as ParseRow | null;
  if (!parse) notFound();

  // Is there still a publish step between these items and a family's phone? The
  // whole tone of this screen turns on the answer, so it is read, not assumed.
  const { data: itinRow } = await supabase
    .from("itineraries")
    .select("status")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const isLive = (itinRow as { status: string } | null)?.status === "published";

  const parsed = parse.raw_output?.parsed;
  const items = parsed?.items ?? [];
  const ambiguities = parsed?.ambiguities ?? [];
  const issues = parse.raw_output?.issues ?? [];

  // Signed URL for the source document.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", parse.document_id)
    .eq("program_id", program.id)
    .maybeSingle();
  let signedUrl: string | null = null;
  const path = (doc as { storage_path: string } | null)?.storage_path;
  if (path) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 3600);
    signedUrl = signed?.signedUrl ?? null;
  }

  // The same five-step strip the packet and itinerary pages show (US7-4) — but
  // about THIS parse, not the competition's latest one. Those pages are about
  // the competition, so latest is right for them; this screen is about the parse
  // in its URL, and deriving the strip from a newer sibling meant a failed
  // re-upload could print "Parsed — stuck" across the top of an accepted draft.
  // The row is already loaded above, so being parse-specific also costs a query
  // less than being wrong did.
  const compBase = `/${slug}/competitions/${competitionId}`;
  const pipeline = packetPipelineSteps(
    await loadPacketPipeline(supabase, {
      programId: program.id,
      competitionId,
      parse: { id: parse.id, status: parse.status },
    }),
    compBase,
  );

  return (
    <section className="stack">
      <p>
        <Link href={`${compBase}/packet`}>← Packet</Link>
      </p>
      <SubTabs strip={competitionTabs(slug, competitionId, "packet")} />
      <PacketPipeline steps={pipeline} />
      <div className="page-title-row">
        <h1>Review parsed packet</h1>
        {showGuide && (
          <HelpDot href={`${compBase}/packet/${parseId}/review?help=1`} />
        )}
      </div>
      {showGuide && (
        <IntroStrip
          surfaceKey="packet_review"
          programId={program.id}
          selfPath={`${compBase}/packet/${parseId}/review`}
          guideState={guideState}
          help={showHelp}
        />
      )}
      {flash.error && <p className="alert-error">{flash.error.message}</p>}
      {isLive ? (
        <p className="alert-error">
          AI-drafted from the host packet. This competition&apos;s itinerary is
          already <strong>published</strong>, so accepting replaces the times
          families are reading right now — there is no publish step left after
          it. Times are shown in {formatTimeZoneLabel(tz)}.
        </p>
      ) : (
        <p className="muted">
          AI-drafted from the host packet. Nothing here reaches a parent until
          you accept it here and then publish the itinerary. Times are shown in{" "}
          {formatTimeZoneLabel(tz)}.
        </p>
      )}

      {parsed?.competition && (
        <p className="muted">
          Detected: perform {parsed.competition.perform_time ?? "—"} · homeroom{" "}
          {parsed.competition.homeroom ?? "—"} · awards{" "}
          {parsed.competition.awards_time ?? "—"}
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

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1.5rem",
          width: "100%",
        }}
      >
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
          {items.length === 0 && (
            <p className="muted">No items were extracted.</p>
          )}
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
                      <select
                        name={`item_${i}_kind`}
                        defaultValue={
                          (ITINERARY_ITEM_KINDS as readonly string[]).includes(
                            item.kind,
                          )
                            ? item.kind
                            : "other"
                        }
                      >
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
                      <input
                        type="text"
                        name={`item_${i}_title`}
                        defaultValue={item.title ?? ""}
                      />
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
              {isLive ? (
                // The extra, explicit yes. Not a nicety: without it one click
                // puts AI-drafted times in front of every family, and the
                // action refuses a post that does not carry this (./actions).
                <div className="confirm-box stack">
                  <strong>These replace what families see now</strong>
                  <p>
                    The itinerary for this competition is published. Accepting
                    removes the times families are reading and puts these in
                    their place immediately — nothing else has to happen for
                    them to see it.
                  </p>
                  <label className="row-inline">
                    <input
                      type="checkbox"
                      name="confirm"
                      value={ACCEPT_LIVE_CONFIRM}
                      required
                    />
                    I have read these times and I want families to see them now.
                  </label>
                </div>
              ) : (
                <p className="muted">
                  Accepting replaces the draft itinerary&apos;s items with
                  these. You can keep editing on the Itinerary tab, then publish
                  there.
                </p>
              )}
              <button type="submit">
                {isLive
                  ? "Replace what families see"
                  : "Accept into draft itinerary"}
              </button>
            </form>
          ) : (
            <p className="muted">
              Read-only — a director or admin can accept this draft.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
