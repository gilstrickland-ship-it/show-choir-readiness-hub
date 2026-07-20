import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import {
  COMPETITION_WRITE_ROLES,
  ITINERARY_ITEM_KINDS,
  ITINERARY_ITEM_KIND_LABELS,
  type ItineraryItemKind,
} from "@/lib/competitions";
import { formatDateTimeInTz, toZonedInputValue } from "@/lib/datetime";
import { activeShareLinks, shareLinkUrl } from "@/lib/tokens";
import { CompetitionTabs } from "../CompetitionTabs";
import {
  addItineraryItem,
  updateItineraryItem,
  deleteItineraryItem,
  publishItinerary,
  unpublishItinerary,
  regenerateItineraryShareLink,
} from "./actions";

// Manual itinerary editor (§5, T014). One itinerary per competition, created as a
// draft on first open. Items edit inline; publish gates parent visibility
// (invariant §9.3). If a host packet document exists it renders alongside via a
// signed Storage URL so the director can transcribe/verify against the source.

interface ItinRow {
  id: string;
  status: "draft" | "published";
  published_at: string | null;
  source: "manual" | "parsed";
}

interface ItemRow {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
  kind: string;
  title: string | null;
  location: string | null;
  details: string | null;
  sort_order: number;
}

export default async function ItineraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  searchParams: Promise<{
    published?: string;
    confirm?: string;
    share?: string;
    accepted?: string;
  }>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  const tz = program.timezone;
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

  // One itinerary per competition; create a draft on first open (writers only).
  let { data: itinData } = await supabase
    .from("itineraries")
    .select("id, status, published_at, source")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (!itinData && canWrite) {
    const { data: created } = await supabase
      .from("itineraries")
      .insert({
        program_id: program.id,
        competition_id: competitionId,
        status: "draft",
        source: "manual",
      })
      .select("id, status, published_at, source")
      .single();
    itinData = created;
  }
  const itinerary = itinData as ItinRow | null;

  const { data: itemData } = itinerary
    ? await supabase
        .from("itinerary_items")
        .select("id, starts_at, ends_at, kind, title, location, details, sort_order")
        .eq("itinerary_id", itinerary.id)
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true })
        .order("starts_at", { ascending: true, nullsFirst: false })
    : { data: null };
  const items = (itemData as ItemRow[] | null) ?? [];

  // Uploaded host packet alongside the editor (§5 step 6 / T014).
  const { data: docData } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("program_id", program.id)
    .eq("competition_id", competitionId)
    .eq("kind", "host_packet")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let signedUrl: string | null = null;
  const storagePath = (docData as { storage_path: string } | null)?.storage_path;
  if (storagePath) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600);
    signedUrl = signed?.signedUrl ?? null;
  }

  const showPublishConfirm = sp.confirm === "publish" && canWrite && itinerary?.status === "draft";

  // Broadcast share link (FR-002 / §8a). Active links are metadata-only (the raw
  // URL is knowable only at mint time), so the copyable URL is shown once when it
  // rides in via ?share=; otherwise we show that a link is active + a rotate button.
  const isPublished = itinerary?.status === "published";
  const activeItinShareLinks = isPublished
    ? (await activeShareLinks(supabase, program.id)).filter(
        (l) => l.resource === "itinerary" && l.resource_id === competitionId,
      )
    : [];
  const freshShareUrl = sp.share ? shareLinkUrl(sp.share) : null;

  return (
    <section className="stack">
      <CompetitionTabs slug={slug} competitionId={competitionId} active="itinerary" />
      <h1>Itinerary</h1>

      {sp.published && <p className="alert-ok">Itinerary published — visible to parents.</p>}
      {sp.accepted && (
        <p className="alert-ok">
          Parsed itinerary applied — review the items below, then publish.
        </p>
      )}

      {/* Broadcast share link (FR-002 / §8a) — read-only URL anyone can open. */}
      {canWrite && isPublished && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Broadcast link</h2>
          {freshShareUrl ? (
            <>
              <p className="muted">
                A read-only link to this itinerary — copy it now (for privacy the
                URL is shown only this once):
              </p>
              <code style={{ wordBreak: "break-all" }}>{freshShareUrl}</code>
            </>
          ) : activeItinShareLinks.length > 0 ? (
            <p className="muted">
              A broadcast link is active for this itinerary. For your privacy the
              URL is only shown once at creation — regenerate to get a fresh
              copyable link (the old one stops working). Active links are listed in{" "}
              <Link href={`/${slug}/settings`}>Settings → Share links</Link>.
            </p>
          ) : (
            <p className="muted">
              No broadcast link yet. Generate a read-only link to share this
              itinerary with anyone.
            </p>
          )}
          <form action={regenerateItineraryShareLink}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <button type="submit" className="secondary">
              {activeItinShareLinks.length > 0
                ? "Regenerate broadcast link"
                : "Create broadcast link"}
            </button>
          </form>
        </div>
      )}

      {!itinerary && (
        <p className="muted">No itinerary yet. A director or admin can create one here.</p>
      )}

      {itinerary && (
        <p className="muted">
          Status: <span className="badge">{itinerary.status}</span> · source{" "}
          {itinerary.source}
          {itinerary.status === "published" && itinerary.published_at
            ? ` · published ${formatDateTimeInTz(itinerary.published_at, tz)}`
            : ""}
          {itinerary.status === "published" && (
            <>
              {" · "}
              <a href={`/api/pdf/packet?competition=${competitionId}`}>
                Download parent packet (PDF)
              </a>
            </>
          )}
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", width: "100%" }}>
        {/* ---- Editor column ---- */}
        <div className="stack" style={{ flex: "1 1 22rem", minWidth: "18rem" }}>
          <table className="members">
            <thead>
              <tr>
                <th>Order</th>
                <th>Time</th>
                <th>Kind</th>
                <th>Title / location</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) =>
                canWrite && itinerary?.status === "draft" ? (
                  <tr key={item.id}>
                    <td colSpan={5}>
                      <form action={updateItineraryItem} className="row-inline">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="competitionId" value={competitionId} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="tz" value={tz} />
                        <input
                          type="number"
                          name="sort_order"
                          className="num"
                          defaultValue={item.sort_order}
                          aria-label="Sort order"
                          style={{ width: "3.5rem" }}
                        />
                        <input
                          type="datetime-local"
                          name="starts_at"
                          defaultValue={toZonedInputValue(item.starts_at, tz)}
                          aria-label="Starts at"
                        />
                        <input
                          type="datetime-local"
                          name="ends_at"
                          defaultValue={toZonedInputValue(item.ends_at, tz)}
                          aria-label="Ends at"
                        />
                        <select name="kind" defaultValue={item.kind} aria-label="Kind">
                          {ITINERARY_ITEM_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {ITINERARY_ITEM_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          name="title"
                          defaultValue={item.title ?? ""}
                          aria-label="Title"
                        />
                        <input
                          type="text"
                          name="location"
                          defaultValue={item.location ?? ""}
                          placeholder="Location"
                          aria-label="Location"
                        />
                        <input
                          type="text"
                          name="details"
                          defaultValue={item.details ?? ""}
                          placeholder="Details"
                          aria-label="Details"
                        />
                        <button type="submit" className="secondary">
                          Save
                        </button>
                      </form>
                    </td>
                    {canWrite && (
                      <td>
                        <form action={deleteItineraryItem}>
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="competitionId" value={competitionId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <button type="submit" className="linklike danger">
                            Delete
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ) : (
                  <tr key={item.id}>
                    <td>{item.sort_order}</td>
                    <td>{formatDateTimeInTz(item.starts_at, tz)}</td>
                    <td>{ITINERARY_ITEM_KIND_LABELS[item.kind as ItineraryItemKind] ?? item.kind}</td>
                    <td>
                      {item.title}
                      {item.location ? <span className="muted"> · {item.location}</span> : null}
                    </td>
                    {canWrite && <td></td>}
                  </tr>
                ),
              )}
              {items.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="muted">
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {canWrite && itinerary && itinerary.status === "draft" && (
            <>
              <h2>Add an item</h2>
              <form action={addItineraryItem} className="stack">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="competitionId" value={competitionId} />
                <input type="hidden" name="itineraryId" value={itinerary.id} />
                <input type="hidden" name="tz" value={tz} />
                <div className="row-inline">
                  <label>
                    Order
                    <input type="number" name="sort_order" className="num" defaultValue={items.length + 1} />
                  </label>
                  <label>
                    Kind
                    <select name="kind" defaultValue="other">
                      {ITINERARY_ITEM_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {ITINERARY_ITEM_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Starts at
                    <input type="datetime-local" name="starts_at" />
                  </label>
                  <label>
                    Ends at
                    <input type="datetime-local" name="ends_at" />
                  </label>
                </div>
                <div className="row-inline">
                  <label>
                    Title
                    <input type="text" name="title" required />
                  </label>
                  <label>
                    Location
                    <input type="text" name="location" />
                  </label>
                  <label>
                    Details
                    <input type="text" name="details" />
                  </label>
                </div>
                <button type="submit">Add item</button>
              </form>
            </>
          )}

          {/* ---- Publish / unpublish ---- */}
          {canWrite && itinerary && (
            <div className="stack">
              {itinerary.status === "draft" ? (
                showPublishConfirm ? (
                  <div className="stack confirm-box">
                    <p>
                      Publish this itinerary? Parents will be able to see it, and it
                      unlocks packet generation. You can unpublish to edit again.
                    </p>
                    <form action={publishItinerary} className="row-inline">
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <input type="hidden" name="itineraryId" value={itinerary.id} />
                      <button type="submit">Confirm publish</button>
                      <Link href={`/${slug}/competitions/${competitionId}/itinerary`}>Cancel</Link>
                    </form>
                  </div>
                ) : (
                  <p>
                    <Link
                      href={`/${slug}/competitions/${competitionId}/itinerary?confirm=publish`}
                    >
                      Publish itinerary…
                    </Link>
                  </p>
                )
              ) : (
                <form action={unpublishItinerary}>
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="competitionId" value={competitionId} />
                  <input type="hidden" name="itineraryId" value={itinerary.id} />
                  <button type="submit" className="secondary">
                    Unpublish (back to draft)
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* ---- Packet-alongside column ---- */}
        {signedUrl && (
          <div style={{ flex: "1 1 22rem", minWidth: "18rem" }}>
            <h2>Host packet</h2>
            <object
              data={signedUrl}
              type="application/pdf"
              width="100%"
              height="600"
              style={{ border: "1px solid var(--border)", borderRadius: 8 }}
            >
              <p className="muted">
                <a href={signedUrl}>Open the uploaded packet</a>
              </p>
            </object>
          </div>
        )}
      </div>
    </section>
  );
}
