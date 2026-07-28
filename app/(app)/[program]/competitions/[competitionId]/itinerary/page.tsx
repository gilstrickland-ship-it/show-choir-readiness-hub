import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { formatDateTimeInTz } from "@/lib/datetime";
import {
  groupItemsByDay,
  changedSincePublish,
  editedItemsSincePublish,
} from "@/lib/itinerary-days";
import { activeShareLinks, shareLinkUrl } from "@/lib/tokens";
import { SubTabs } from "../../../SubTabs";
import { ShareLinkCard } from "../../../ShareLinkCard";
import { Flash } from "../../../Flash";
import { readFlash, oneParam, type PageFlash } from "@/lib/flash";
import { competitionTabs } from "@/lib/subnav";
import { PacketPipeline } from "../PacketPipeline";
import { loadPacketPipeline, packetPipelineSteps } from "@/lib/packet-pipeline";
import { regenerateItineraryShareLink } from "./actions";
import { AddItem } from "./AddItem";
import { PublishGate } from "./PublishGate";
import { ItineraryRow, type ItineraryItem } from "./ItineraryRow";
import { ITIN_FLASH_MAPS, itemAnchor, type ItinSection } from "./shared";

// Manual itinerary editor (§5, T014). One itinerary per competition, created as
// a draft on first open. Publishing gates parent visibility (invariant §9.3),
// and a published itinerary stays editable in place (T055) — comp-day schedules
// drift, so publish is a visibility switch, not a freeze. If a host packet
// document exists it renders alongside via a signed Storage URL so the director
// can transcribe against the source.
//
// Spec 005 T156 gave the page the idioms every other list already had. It was
// 600 lines and six forms: every row WAS a form of seven permanently-open
// inputs (so the schedule could only be read out of text boxes), a seventh
// nine-input block sat permanently under the table, and four search params
// printed four messages in a pile at the top. Now the rows state the facts and
// their inputs live behind one row-local Edit panel (ItineraryRow), adding is a
// drawer off the page head (AddItem), the publish gate is its own component
// (PublishGate, unchanged in behaviour), and one `?ok=`/`?error=` contract puts
// each message inside the control that produced it (./shared).
//
// The first-use intro strip is gone (spec 005 Wave 9 / T146). It said "this
// schedule is the one families see. Publish it once, then keep it current — any
// change reaches their phones the moment you save" — which is now the status
// line under the heading ("Only staff can see this" / "Families can see this"),
// the changed-since-publish notice, and every branch of the PublishGate, which
// says it before you publish, after you publish, and inside the confirm box.

interface ItinRow {
  id: string;
  status: "draft" | "published";
  published_at: string | null;
  // When this schedule's ITEMS last changed, deletions included (migration
  // 0024). Stamped by a trigger, never by this app.
  items_changed_at: string | null;
  source: "manual" | "parsed";
}

const ITIN_COLUMNS = "id, status, published_at, items_changed_at, source";

export default async function ItineraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; competitionId: string }>;
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, competitionId } = await params;
  const { program, role, flags } = await getTenantContext(slug);
  requireFlag(program, "competitions");
  const canWrite = COMPETITION_WRITE_ROLES.includes(role);
  // Is /comms/announcements actually reachable for this program? Both flags gate
  // it (spec 005 US9-4); the roles line up already — COMPETITION_WRITE_ROLES and
  // ANNOUNCEMENT_WRITE_ROLES are both director/admin.
  const canAnnounce = flags.comms && flags.announcements;
  const tz = program.timezone;
  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);
  const selfHref = `/${slug}/competitions/${competitionId}/itinerary`;

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
    .select(ITIN_COLUMNS)
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
      .select(ITIN_COLUMNS)
      .single();
    itinData = created;
  }
  const itinerary = itinData as ItinRow | null;

  const { data: itemData } = itinerary
    ? await supabase
        .from("itinerary_items")
        .select(
          "id, starts_at, ends_at, kind, title, location, details, sort_order, updated_at",
        )
        .eq("itinerary_id", itinerary.id)
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true })
        .order("starts_at", { ascending: true, nullsFirst: false })
    : { data: null };
  const items = (itemData as ItineraryItem[] | null) ?? [];

  // C2-2: when the schedule has changed since publishing, families already see
  // the update (the parent page is live) — but nobody is notified automatically.
  // Calm nudge, not an alarm. Reachable now that published itineraries stay
  // editable in place (T055) — no unpublish/republish round-trip resets it.
  //
  // T169: whether there IS a change comes from the itinerary row's
  // `items_changed_at`, which a trigger stamps on delete as well as on save. The
  // per-item count below is a detail on top of it, and it is exactly the number
  // that used to be the whole test — which is why removing a line from a
  // published schedule used to produce no notice at all. Zero edited items while
  // something changed can only mean a line was taken off, so the nudge says so.
  const isPublished = itinerary?.status === "published";
  const change = isPublished
    ? changedSincePublish(itinerary!.items_changed_at, itinerary!.published_at)
    : { changed: false, changedAt: null };
  const editedSincePublish = change.changed
    ? editedItemsSincePublish(items, itinerary!.published_at)
    : 0;
  const removedSincePublish = change.changed && editedSincePublish === 0;

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
  const storagePath = (docData as { storage_path: string } | null)
    ?.storage_path;
  if (storagePath) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600);
    signedUrl = signed?.signedUrl ?? null;
  }

  // Packet pipeline strip (US7-4) — the last two steps of it happen on this page.
  // Only when a packet was actually uploaded and parsing is on: a hand-entered
  // itinerary has no packet half, and the strip would be four grey steps of
  // nothing. The itinerary state it needs is already loaded above.
  const pipeline =
    flags.packet_parse && storagePath
      ? packetPipelineSteps(
          await loadPacketPipeline(supabase, {
            programId: program.id,
            competitionId,
            itinerary: {
              published: isPublished,
              itemCount: items.length,
            },
          }),
          `/${slug}/competitions/${competitionId}`,
        )
      : null;

  // Broadcast share link (FR-002 / §8a). Active links are metadata-only (the raw
  // URL is knowable only at mint time), so the copyable URL is shown once when it
  // rides in via ?share=; otherwise we show that a link is active + a rotate button.
  //
  // Read on a DRAFT too, not just a published one: unpublishing does not revoke
  // the link, so a draft itinerary can still have a live public address — and
  // the publish confirm box has to say whether it is about to create one or
  // simply keep the one that is already out there.
  const activeItinShareLinks = (
    await activeShareLinks(supabase, program.id)
  ).links.filter(
    (l) => l.resource === "itinerary" && l.resource_id === competitionId,
  );
  const shareParam = one("share");
  const freshShareUrl = shareParam ? shareLinkUrl(shareParam) : null;

  // Day grouping (Wave G / G2): headers only when items span >1 calendar day.
  const { multiDay, groups: dayGroups } = groupItemsByDay(
    items,
    tz,
    (i) => i.starts_at,
  );
  const columns = canWrite ? 5 : 4;

  // ---- One `?ok=` and one `?error=`, each naming its own section ------------
  // `?edit=<itemId>` says WHICH row a row-owned message belongs to; a row-owned
  // code whose row is not on this page (an item someone else deleted) would
  // render nowhere at all, so it falls back to the page banner instead.
  const flash = readFlash<ItinSection>(sp, ITIN_FLASH_MAPS);
  const openId = canWrite ? one("edit") : null;
  const rowOnPage = !!openId && items.some((i) => i.id === openId);
  const errSection = flash.error?.section ?? null;
  const stranded = errSection === "row" && !rowOnPage;
  const pageFlash: PageFlash<ItinSection> = stranded
    ? { ok: flash.ok, error: { section: "page", message: flash.error!.message } }
    : flash;
  const rowError =
    !stranded && errSection === "row" ? (flash.error?.message ?? null) : null;
  const drawerError =
    errSection === "drawer" ? (flash.error?.message ?? null) : null;
  const confirmDeleteId = one("confirm") === "remove" ? openId : null;
  const confirmPublish =
    one("confirm") === "publish" && canWrite && itinerary?.status === "draft";

  // This page's URL with one row's panel open, closed, or asking to remove.
  // Built here, not in the row, so the row never has to know which params the
  // page keeps — and every one of the three lands back on the row itself.
  const rowHref = (
    itemId: string,
    mode: "open" | "close" | "confirm",
  ): string => {
    const anchor = `#${itemAnchor(itemId)}`;
    if (mode === "close") return `${selfHref}${anchor}`;
    const confirm = mode === "confirm" ? "&confirm=remove" : "";
    return `${selfHref}?edit=${itemId}${confirm}${anchor}`;
  };

  const renderRow = (item: ItineraryItem) => (
    <ItineraryRow
      key={item.id}
      programId={program.id}
      slug={slug}
      competitionId={competitionId}
      tz={tz}
      item={item}
      canWrite={canWrite}
      open={openId === item.id}
      confirmDelete={confirmDeleteId === item.id}
      error={openId === item.id ? rowError : null}
      columns={columns}
      rowHref={rowHref}
    />
  );

  return (
    <section className="stack">
      <SubTabs strip={competitionTabs(slug, competitionId, "itinerary")} />

      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{comp.name}</p>
          <h1 className="page-h1">Itinerary</h1>
        </div>
        {canWrite && itinerary && (
          <div className="page-head-actions">
            <AddItem
              programId={program.id}
              slug={slug}
              competitionId={competitionId}
              itineraryId={itinerary.id}
              tz={tz}
              nextOrder={items.length + 1}
              open={!!drawerError}
              error={drawerError}
            />
          </div>
        )}
      </div>

      {pipeline && <PacketPipeline steps={pipeline} />}

      <Flash flash={pageFlash} section="page" />

      {change.changed &&
        (canWrite ? (
          <p className="alert-info">
            {removedSincePublish
              ? "You've taken a line off this schedule since publishing. Families who open their link no longer see it — but nobody is notified automatically."
              : "You've changed this schedule since publishing. Families who open their link see the update immediately — but nobody is notified automatically."}
            {/* Only offer the announcement route when this program actually has
                it: both flags gate that page (spec 005 US9-4), and a nudge that
                sends a director to a 404 is worse than no nudge. */}
            {canAnnounce && (
              <>
                {" "}
                Send a quick announcement if the change matters.{" "}
                <Link href={`/${slug}/comms/announcements`}>
                  Go to announcements →
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="alert-info">
            {removedSincePublish
              ? "A line has been taken off this schedule since it was published. Families who open their link no longer see it."
              : "This schedule has changed since it was published. Families who open their link see the update immediately."}
          </p>
        ))}

      {!itinerary && (
        <p className="muted">
          No itinerary yet. A director or admin can create one here.
        </p>
      )}

      {itinerary && (
        <p className="muted">
          {isPublished ? "Families can see this" : "Only staff can see this"} ·{" "}
          {itinerary.source === "parsed"
            ? "from the host packet"
            : "entered by hand"}
          {isPublished && itinerary.published_at
            ? ` · published ${formatDateTimeInTz(itinerary.published_at, tz)}`
            : ""}
          {isPublished && (
            <>
              {" · "}
              <a href={`/api/pdf/packet?competition=${competitionId}`}>
                Download parent packet (PDF)
              </a>
            </>
          )}
        </p>
      )}

      {/* Broadcast share link (FR-002 / §8a) — read-only URL anyone can open. */}
      {canWrite && isPublished && (
        <ShareLinkCard
          resource="itinerary"
          programId={program.id}
          slug={slug}
          subject=""
          resourceIdField={{ name: "competitionId", value: competitionId }}
          action={regenerateItineraryShareLink}
          liveCount={activeItinShareLinks.length}
          freshUrls={freshShareUrl ? [freshShareUrl] : null}
          message={<Flash flash={pageFlash} section="share" />}
        />
      )}

      <div className="itinerary-layout">
        {/* ---- Editor column ---- */}
        <div className="stack itinerary-editor">
          <table className="members">
            <thead>
              <tr>
                <th>Order</th>
                <th>Time</th>
                <th>Kind</th>
                <th>What happens</th>
                {canWrite && <th className="table-action"></th>}
              </tr>
            </thead>
            <tbody>
              {multiDay
                ? dayGroups.map((g) => (
                    <Fragment key={g.key || "untimed"}>
                      <tr className="itinerary-day-head">
                        <td colSpan={columns}>
                          <strong>{g.label}</strong>
                        </td>
                      </tr>
                      {g.items.map(renderRow)}
                    </Fragment>
                  ))
                : items.map(renderRow)}
              {items.length === 0 && (
                <tr>
                  <td colSpan={columns} className="muted">
                    Nothing on this schedule yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {canWrite && itinerary && (
            <PublishGate
              programId={program.id}
              slug={slug}
              competitionId={competitionId}
              itineraryId={itinerary.id}
              status={itinerary.status}
              confirmPublish={confirmPublish}
              canAnnounce={canAnnounce}
              hasLiveShareLink={activeItinShareLinks.length > 0}
              selfHref={selfHref}
            />
          )}
        </div>

        {/* ---- Packet-alongside column ---- */}
        {signedUrl && (
          <div className="itinerary-packet">
            <h2>Host packet</h2>
            <object
              data={signedUrl}
              type="application/pdf"
              width="100%"
              height="600"
              className="itinerary-packet-view"
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
