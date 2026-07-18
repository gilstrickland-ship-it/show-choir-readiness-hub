import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembership } from "@/lib/auth";
import { TREASURY_ROLES } from "@/lib/nav";
import {
  loadTripDoc,
  loadPacketData,
  loadBoardSnapshot,
} from "@/lib/pdf/queries";
import { BusManifest, RoomSheet, ParentPacket, BoardSnapshot } from "@/lib/pdf/documents";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactElement } from "react";

// React-PDF renderers (§6, §7, T017) — replaces the 501 stub. Node runtime only,
// so React-PDF stays out of every client bundle (imported by nothing else). Each
// document is derived from live data (Constitution VI); nothing is stored. Auth:
// the caller's RLS client already enforces tenant isolation (a non-member sees
// the resource as missing → 404); membership + role are re-checked here for a
// clean 403 and, for the board snapshot, the treasury-read gate (§2).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

async function resolveProgramId(
  supabase: SupabaseClient,
  table: "trips" | "competitions" | "seasons",
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select("program_id")
    .eq("id", id)
    .maybeSingle();
  return (data as { program_id: string } | null)?.program_id ?? null;
}

async function pdf(element: ReactElement, filename: string): Promise<Response> {
  // Each renderer is a component that returns a <Document>; react-pdf reconciles
  // the tree to that root at render time. The cast bridges the wrapper element's
  // props to renderToBuffer's DocumentProps signature.
  const buffer = await renderToBuffer(element as ReactElement<DocumentProps>);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ doc: string }> },
) {
  const { doc } = await params;
  const url = new URL(request.url);

  const user = await getSessionUser();
  if (!user) return text("Not authenticated", 401);

  const supabase = await createClient();

  if (doc === "bus" || doc === "rooms") {
    const tripId = url.searchParams.get("trip");
    if (!tripId) return text("Missing ?trip=", 400);
    const programId = await resolveProgramId(supabase, "trips", tripId);
    if (!programId) return text("Trip not found", 404);
    const membership = await getMembership(programId, user.id);
    if (!membership) return text("Forbidden", 403);

    const data = await loadTripDoc(supabase, tripId);
    if (!data) return text("Trip not found", 404);

    if (doc === "bus") {
      return pdf(<BusManifest data={data} />, `bus-manifest-${tripId}.pdf`);
    }
    const variant = url.searchParams.get("variant") === "door" ? "door" : "default";
    return pdf(<RoomSheet data={data} variant={variant} />, `room-sheet-${tripId}.pdf`);
  }

  if (doc === "packet") {
    const competitionId = url.searchParams.get("competition");
    if (!competitionId) return text("Missing ?competition=", 400);
    const programId = await resolveProgramId(supabase, "competitions", competitionId);
    if (!programId) return text("Competition not found", 404);
    const membership = await getMembership(programId, user.id);
    if (!membership) return text("Forbidden", 403);

    const data = await loadPacketData(supabase, competitionId);
    if (!data) return text("Competition not found", 404);
    // Invariant §9.3: the packet is gated on a published itinerary.
    if (!data.itineraryPublished) {
      return text(
        "This competition's itinerary is not published yet. Publish it before generating the parent packet.",
        409,
      );
    }
    return pdf(<ParentPacket data={data} />, `parent-packet-${competitionId}.pdf`);
  }

  if (doc === "board-snapshot") {
    const seasonId = url.searchParams.get("season");
    if (!seasonId) return text("Missing ?season=", 400);
    const programId = await resolveProgramId(supabase, "seasons", seasonId);
    if (!programId) return text("Season not found", 404);
    const membership = await getMembership(programId, user.id);
    // Treasury read is director/admin/treasurer/board_member (§2) — NOT costume_manager.
    if (!membership || !TREASURY_ROLES.includes(membership.role)) {
      return text("Forbidden", 403);
    }

    const data = await loadBoardSnapshot(supabase, seasonId);
    if (!data) return text("Season not found", 404);
    return pdf(<BoardSnapshot data={data} />, `board-snapshot-${seasonId}.pdf`);
  }

  return text(`Unknown document "${doc}".`, 404);
}
