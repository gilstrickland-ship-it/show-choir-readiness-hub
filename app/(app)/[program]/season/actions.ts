"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type Role } from "@/lib/auth";
import { mintShareLink, revokeShareLinksForResource } from "@/lib/tokens";

// Season page server actions (Wave G / G1). Minting/rotating the season-calendar
// share link is director/admin only — the share_links RLS write policy gates on
// those roles (same posture as the itinerary/signup broadcast links).
const SHARE_LINK_ROLES: readonly Role[] = ["director", "admin"];

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function seasonPath(slug: string): string {
  return `/${slug}/season`;
}

// Mint (or rotate) the subscribable season-calendar share link (§8a, FR-002). The
// resource_id is the active season id — the natural unit a "subscribe to our whole
// season" link addresses. Rotates: any active season_calendar link for this season
// is revoked first so the newest URL is always the live one, then the fresh raw
// feed URL rides ?share= to be shown once (hash-only storage — never re-shown).
export async function regenerateSeasonCalendarShareLink(
  formData: FormData,
): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = str(formData, "seasonId");
  await requireRole(programId, SHARE_LINK_ROLES);
  if (!seasonId) redirect(`${seasonPath(slug)}?calError=season`);

  const supabase = await createClient();
  await revokeShareLinksForResource(supabase, {
    programId,
    resource: "season_calendar",
    resourceId: seasonId,
  });
  const minted = await mintShareLink(supabase, {
    programId,
    resource: "season_calendar",
    resourceId: seasonId,
  });
  const share = "raw" in minted ? minted.raw : "";

  revalidatePath(seasonPath(slug));
  redirect(
    `${seasonPath(slug)}${share ? `?calShare=${encodeURIComponent(share)}` : ""}`,
  );
}
