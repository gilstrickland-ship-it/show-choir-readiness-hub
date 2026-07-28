"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES, ITINERARY_ITEM_KINDS } from "@/lib/competitions";
import { zonedWallToUtc } from "@/lib/datetime";
import {
  mintShareLink,
  revokeShareLinksForResource,
  activeShareLinks,
} from "@/lib/tokens";
import { programPath } from "@/lib/return-path";
import {
  isRowItinError,
  itemAnchor,
  type ItinErrorKey,
  type ItinOkKey,
} from "./shared";

// Manual itinerary editor (§5, T014). One itinerary per competition; items CRUD;
// publish gates parent visibility (invariant §9.3). Times arrive as program-tz
// wall clock from datetime-local inputs and are stored UTC (Constitution VII).
//
// Every redirect here goes through the page's flash contract (./shared): a
// refusal that belongs to ONE item comes back on that item's `?edit=` address
// and its anchor, so the message renders inside the panel that produced it
// rather than in a pile above a table the writer then has to re-find their row
// in (spec 005 Wave 10 / T156).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function wallToIso(fd: FormData, key: string, tz: string): string | null {
  const d = zonedWallToUtc(str(fd, key), tz);
  return d ? d.toISOString() : null;
}

function itinPath(slug: string, competitionId: string): string {
// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  return programPath(slug, `competitions/${competitionId}/itinerary`) ?? "/";
}

// A refusal's address. Row-owned codes carry the item they belong to, so the
// panel reopens with the message inside it; everything else lands on the page.
// Which of the two a code IS comes from the map, never from the call site.
function failPath(
  slug: string,
  competitionId: string,
  key: ItinErrorKey,
  itemId?: string,
): string {
  const base = itinPath(slug, competitionId);
  if (itemId && isRowItinError(key)) {
    return `${base}?edit=${itemId}&error=${key}#${itemAnchor(itemId)}`;
  }
  return `${base}?error=${key}`;
}

function okPath(
  slug: string,
  competitionId: string,
  key: ItinOkKey,
  extra?: string,
): string {
  return `${itinPath(slug, competitionId)}?ok=${key}${extra ?? ""}`;
}

// The itinerary this competition owns, resolved from the ids a form posted.
// `itineraryId` and `itemId` are hidden fields: proving the caller directs THIS
// program says nothing about who owns the rows they named (Constitution I).
async function resolveItinerary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  competitionId: string,
  itineraryId: string,
): Promise<string | null> {
  if (!programId || !competitionId || !itineraryId) return null;
  const { data } = await supabase
    .from("itineraries")
    .select("id")
    .eq("id", itineraryId)
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// One item, only when it hangs off THIS competition's itinerary. Program scoping
// alone would let a hand-edited `itemId` rewrite a line on a different
// competition's schedule inside the same program — a published one, invisibly.
async function resolveItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  competitionId: string,
  itemId: string,
): Promise<string | null> {
  if (!programId || !competitionId || !itemId) return null;
  const { data } = await supabase
    .from("itinerary_items")
    .select("id, itineraries!inner(id, competition_id, program_id)")
    .eq("id", itemId)
    .eq("program_id", programId)
    .eq("itineraries.program_id", programId)
    .eq("itineraries.competition_id", competitionId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// Did that write actually happen? PostgREST answers a write that MATCHED NOTHING
// exactly like a write that succeeded: `error` is null and the caller is none
// the wiser. On a surface where RLS is the real gate (an archived season, a role
// that may not write) the row-count is the only difference between "saved" and
// "silently discarded", so every write here asks for `.select("id")` and treats
// zero rows as the failure it is (the local reference is absences/actions.ts).
function wrote(result: { data: unknown; error: unknown }): boolean {
  if (result.error) return false;
  return ((result.data as { id: string }[] | null) ?? []).length > 0;
}

export async function addItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const kind = str(formData, "kind");
  const supabase = await createClient();

  if (!(await resolveItinerary(supabase, programId, competitionId, itineraryId))) {
    redirect(failPath(slug, competitionId, "itinerary"));
  }

  const { error } = await supabase.from("itinerary_items").insert({
    itinerary_id: itineraryId,
    program_id: programId,
    starts_at: wallToIso(formData, "starts_at", tz),
    ends_at: wallToIso(formData, "ends_at", tz),
    kind: (ITINERARY_ITEM_KINDS as readonly string[]).includes(kind) ? kind : "other",
    title: str(formData, "title") || "Untitled",
    location: str(formData, "location") || null,
    details: str(formData, "details") || null,
    sort_order: Number(str(formData, "sort_order")) || 0,
  });
  if (error) redirect(failPath(slug, competitionId, "add"));

  revalidatePath(itinPath(slug, competitionId));
  redirect(okPath(slug, competitionId, "added"));
}

export async function updateItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itemId = str(formData, "itemId");
  const tz = str(formData, "tz") || "UTC";
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const kind = str(formData, "kind");
  const supabase = await createClient();

  if (!(await resolveItem(supabase, programId, competitionId, itemId))) {
    redirect(failPath(slug, competitionId, "gone", itemId));
  }

  const saved = await supabase
    .from("itinerary_items")
    .update({
      starts_at: wallToIso(formData, "starts_at", tz),
      ends_at: wallToIso(formData, "ends_at", tz),
      kind: (ITINERARY_ITEM_KINDS as readonly string[]).includes(kind) ? kind : "other",
      title: str(formData, "title") || "Untitled",
      location: str(formData, "location") || null,
      details: str(formData, "details") || null,
      sort_order: Number(str(formData, "sort_order")) || 0,
    })
    .eq("id", itemId)
    .eq("program_id", programId)
    .select("id");
  // A swallowed failure here is a schedule change the director believes landed
  // and families never see — and an RLS-filtered write is exactly that failure
  // wearing a null error (see `wrote`).
  if (!wrote(saved)) redirect(failPath(slug, competitionId, "save", itemId));

  revalidatePath(itinPath(slug, competitionId));
  redirect(okPath(slug, competitionId, "saved"));
}

export async function deleteItineraryItem(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itemId = str(formData, "itemId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await resolveItem(supabase, programId, competitionId, itemId))) {
    redirect(failPath(slug, competitionId, "gone", itemId));
  }

  const removed = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId)
    .eq("program_id", programId)
    .select("id");
  if (!wrote(removed)) redirect(failPath(slug, competitionId, "remove", itemId));

  revalidatePath(itinPath(slug, competitionId));
  redirect(okPath(slug, competitionId, "removed"));
}

// Publish (invariant §9.3): status → published, published_at set. Confirmed on
// the page. Publishing is the gate for parent visibility / packet generation /
// shift suggestions. On publish we ALSO auto-mint a broadcast share link for the
// itinerary (FR-002 / §8a) so the director has a copyable read-only URL to hand
// out — but only when none is already active, so republishing doesn't pile up
// links. The raw token is knowable only here (hash-only storage), so it rides the
// redirect to be shown once on the page.
export async function publishItinerary(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await resolveItinerary(supabase, programId, competitionId, itineraryId))) {
    redirect(failPath(slug, competitionId, "itinerary"));
  }

  const published = await supabase
    .from("itineraries")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", itineraryId)
    .eq("program_id", programId)
    .select("id");
  // THE gate for parent visibility. Everything below this line — a live public
  // URL, and a banner that tells the director families can see it now — is only
  // true if this landed, so nothing below runs until it is proved.
  if (!wrote(published)) redirect(failPath(slug, competitionId, "publish"));

  // Auto-mint a share link only if this competition has none active yet — and
  // only if we could actually SEE whether it has one. A failed listing used to
  // read as "none", which is how republishing piled up a second live URL for the
  // same itinerary; the director can still mint one from the share card.
  let share = "";
  const listed = await activeShareLinks(supabase, programId);
  const existing = listed.links.filter(
    (l) => l.resource === "itinerary" && l.resource_id === competitionId,
  );
  if (!listed.unavailable && existing.length === 0) {
    const minted = await mintShareLink(supabase, {
      programId,
      resource: "itinerary",
      resourceId: competitionId,
    });
    if ("raw" in minted) share = minted.raw;
  }

  revalidatePath(itinPath(slug, competitionId));
  redirect(
    okPath(
      slug,
      competitionId,
      "published",
      share ? `&share=${encodeURIComponent(share)}` : "",
    ),
  );
}

// Rotate the broadcast link: retire any active itinerary share link for this
// competition and mint a fresh one, surfacing the new raw URL once. This is the
// "the newest link is the live one" model share links inherit from guardian
// tokens — a leaked or stale URL is revoked in one click.
export async function regenerateItineraryShareLink(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  await revokeShareLinksForResource(supabase, {
    programId,
    resource: "itinerary",
    resourceId: competitionId,
  });
  const minted = await mintShareLink(supabase, {
    programId,
    resource: "itinerary",
    resourceId: competitionId,
  });
  // The old link is already retired at this point, so a mint that failed leaves
  // the director with nothing to hand out — and saying nothing would let them
  // send a URL that stopped working.
  if (!("raw" in minted)) redirect(failPath(slug, competitionId, "share"));

  revalidatePath(itinPath(slug, competitionId));
  redirect(
    okPath(
      slug,
      competitionId,
      "link",
      `&share=${encodeURIComponent(minted.raw)}`,
    ),
  );
}

// Return a published itinerary to editable-but-private state. Families stop
// seeing it the moment this lands (invariant §9.3).
export async function unpublishItinerary(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  const itineraryId = str(formData, "itineraryId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await resolveItinerary(supabase, programId, competitionId, itineraryId))) {
    redirect(failPath(slug, competitionId, "itinerary"));
  }

  const unpublished = await supabase
    .from("itineraries")
    .update({ status: "draft", published_at: null })
    .eq("id", itineraryId)
    .eq("program_id", programId)
    .select("id");
  // The same gate, read the other way: told "families no longer see these
  // times" over a write that did not land, a director stops trying to take it
  // down.
  if (!wrote(unpublished)) redirect(failPath(slug, competitionId, "unpublish"));

  revalidatePath(itinPath(slug, competitionId));
  redirect(okPath(slug, competitionId, "unpublished"));
}
