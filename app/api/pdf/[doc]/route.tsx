import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembership } from "@/lib/auth";
import { TREASURY_ROLES, HOSTING_ROLES } from "@/lib/nav";
import { flag, type FlaggableProgram } from "@/lib/flags";
import {
  loadTripDoc,
  loadBoardSnapshot,
  loadMealData,
  loadHostEventDoc,
} from "@/lib/pdf/queries";
import {
  BusManifest,
  RoomSheet,
  BoardSnapshot,
  MealCount,
  HostSchedule,
  HostDoorSigns,
  HostPacket,
} from "@/lib/pdf/documents";
import { renderParentPacket } from "@/lib/pdf/render";
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
  table: "trips" | "competitions" | "seasons" | "hosted_events",
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

    // Shared renderer (one source of truth with the token packet route, F15).
    const result = await renderParentPacket(supabase, competitionId);
    if (!result.ok) return text(result.message, result.status);
    return result.response;
  }

  if (doc === "meal") {
    const competitionId = url.searchParams.get("competition");
    if (!competitionId) return text("Missing ?competition=", 400);
    const programId = await resolveProgramId(supabase, "competitions", competitionId);
    if (!programId) return text("Competition not found", 404);
    const membership = await getMembership(programId, user.id);
    if (!membership) return text("Forbidden", 403);

    const data = await loadMealData(supabase, competitionId);
    if (!data) return text("Competition not found", 404);
    return pdf(<MealCount data={data} />, `meal-count-${competitionId}.pdf`);
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

  if (doc === "host-schedule" || doc === "host-doorsigns" || doc === "host-packet") {
    const eventId = url.searchParams.get("event");
    if (!eventId) return text("Missing ?event=", 400);
    const programId = await resolveProgramId(supabase, "hosted_events", eventId);
    if (!programId) return text("Event not found", 404);
    const membership = await getMembership(programId, user.id);
    // Hosting nav read is director/admin/board_member (§I1) — NOT treasurer/costume.
    if (!membership || !HOSTING_ROLES.includes(membership.role)) {
      return text("Forbidden", 403);
    }
    // Flag gate: a program without host-mode never renders these (Constitution VIII).
    const { data: progRow } = await supabase
      .from("programs")
      .select("tier, feature_overrides")
      .eq("id", programId)
      .maybeSingle();
    const hostingOn = flag(
      (progRow as FlaggableProgram | null) ?? { tier: "prep", feature_overrides: null },
      "hosting",
    );
    if (!hostingOn) return text("Not found", 404);

    const data = await loadHostEventDoc(supabase, eventId);
    if (!data) return text("Event not found", 404);

    if (doc === "host-schedule") {
      return pdf(<HostSchedule data={data} />, `host-schedule-${eventId}.pdf`);
    }
    if (doc === "host-doorsigns") {
      return pdf(<HostDoorSigns data={data} />, `host-door-signs-${eventId}.pdf`);
    }
    return pdf(<HostPacket data={data} />, `host-packets-${eventId}.pdf`);
  }

  return text(`Unknown document "${doc}".`, 404);
}
