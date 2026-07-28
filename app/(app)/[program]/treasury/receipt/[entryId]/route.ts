import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembership } from "@/lib/auth";
import { TREASURY_ROLES } from "@/lib/nav";
import { flag, type FlaggableProgram } from "@/lib/flags";

// Open the receipt attached to one ledger entry.
//
// Receipts were write-only: the add-entry drawer uploaded a file to the private
// `receipts` bucket and nothing in the app could ever show it again — so the
// document that proves what a payment was for existed only for whoever had
// direct storage access. A receipt is part of the money record (Constitution V),
// which means the treasurer AND the board must be able to look at it.
//
// The entry id is the only thing in the URL; the storage path is read off the
// row, never taken from the caller. Scoping is triple: the route resolves the
// program from the slug, re-checks the money read roles against
// program_members (defense in depth), and reads the entry with the caller's own
// RLS client filtered on program_id. The signed URL is short-lived and is minted
// by that same client, so the storage policy (members of the owning program)
// applies underneath as well.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ program: string; entryId: string }> },
) {
  const { program: slug, entryId } = await params;

  const user = await getSessionUser();
  if (!user) return text("Not authenticated", 401);

  const supabase = await createClient();
  const { data: progRow } = await supabase
    .from("programs")
    .select("id, tier, feature_overrides")
    .eq("slug", slug)
    .maybeSingle();
  const program = progRow as ({ id: string } & FlaggableProgram) | null;
  if (!program) return text("Program not found", 404);

  // The flag gate every treasury PAGE runs, which this route did not (it is not
  // a page, so requireFlag's notFound() is the wrong shape — the answer is the
  // same 404). A program with money turned off must not learn the feature
  // exists, so this is indistinguishable from a bad URL, exactly as the pages
  // are (Constitution VIII).
  if (!flag(program, "treasury")) return text("Not found", 404);

  const membership = await getMembership(program.id, user.id);
  if (!membership || !TREASURY_ROLES.includes(membership.role)) {
    return text("Forbidden", 403);
  }

  const { data: entryRow } = await supabase
    .from("ledger_entries")
    .select("receipt_path")
    .eq("id", entryId)
    .eq("program_id", program.id)
    .maybeSingle();
  const path = (entryRow as { receipt_path: string | null } | null)?.receipt_path;
  if (!path) return text("No receipt on that entry", 404);

  const { data: signed } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (!signed?.signedUrl) return text("The receipt could not be opened", 502);

  // 302 to the signed object. The URL is minted here and expires in a minute,
  // so it never lands in a bookmark or a shared link that outlives the session.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "no-store" },
  });
}
