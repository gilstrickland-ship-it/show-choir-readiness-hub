import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembership } from "@/lib/auth";
import { SETTINGS_ROLES } from "@/lib/nav";
import { buildExportZip } from "@/lib/export-zip";

// Export-all direct download (§13.2, T029). Director/admin. Streams a single zip
// built by the shared lib/export-zip builder — the SAME builder the async
// Inngest `export/all` job (T036) runs, so the two paths never diverge. The
// caller's RLS client is the tenant boundary here (every query runs as the
// signed-in director). Kept as the synchronous dev/fallback path alongside the
// "Email me the export" async job. Node runtime (React-PDF).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ program: string }> },
) {
  const { program: slug } = await params;

  const user = await getSessionUser();
  if (!user) return text("Not authenticated", 401);

  const supabase = await createClient();
  const { data: progRow } = await supabase
    .from("programs")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  const program = progRow as { id: string; name: string } | null;
  if (!program) return text("Program not found", 404);

  const membership = await getMembership(program.id, user.id);
  if (!membership || !SETTINGS_ROLES.includes(membership.role)) {
    return text("Forbidden", 403);
  }

  const zipContent = await buildExportZip(supabase, program.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${slug}-export-${stamp}.zip`;

  return new Response(zipContent as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
