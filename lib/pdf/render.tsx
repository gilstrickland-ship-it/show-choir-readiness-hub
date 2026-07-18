import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactElement } from "react";
import { loadPacketData } from "./queries";
import { ParentPacket } from "./documents";

// Shared parent-packet rendering (§9, T017 / F15). ONE source of truth for the
// packet PDF so both surfaces render the identical document:
//   • staff:  app/api/pdf/[doc]/route.tsx (membership-gated, RLS client)
//   • parent: app/(public)/t/[token]/packet/route.ts (token-gated, service role)
// The caller supplies the client (its own auth boundary); this helper only loads
// the data, enforces the published-itinerary invariant (§9.3), and renders.
// SERVER-ONLY — pulls in React-PDF (node runtime).

// A packet PDF as an inline Response (no-store — the packet is derived, never
// cached; Constitution VI).
export function packetPdfResponse(
  buffer: Uint8Array<ArrayBuffer>,
  filename: string,
): Response {
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export type PacketRenderResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; message: string };

// Load + gate + render the parent packet for one competition. Returns a discreet
// error (404 missing / 409 unpublished — invariant §9.3) instead of throwing, so
// each route can translate it to the right status for its surface.
export async function renderParentPacket(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<PacketRenderResult> {
  const data = await loadPacketData(supabase, competitionId);
  if (!data) return { ok: false, status: 404, message: "Competition not found" };
  // Invariant §9.3: the packet is gated on a published itinerary.
  if (!data.itineraryPublished) {
    return {
      ok: false,
      status: 409,
      message:
        "This competition's itinerary is not published yet. The parent packet is available once it is published.",
    };
  }
  const buffer = await renderToBuffer(
    (<ParentPacket data={data} />) as ReactElement<DocumentProps>,
  );
  return {
    ok: true,
    response: packetPdfResponse(new Uint8Array(buffer), `parent-packet-${competitionId}.pdf`),
  };
}
