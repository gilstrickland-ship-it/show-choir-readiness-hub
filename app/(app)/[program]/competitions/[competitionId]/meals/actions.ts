"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { COMPETITION_WRITE_ROLES } from "@/lib/competitions";
import { programPath } from "@/lib/return-path";

// Meal-count logistics note (T031, §5). The note is a competitions column
// (meal_note); writes ride the competitions_write RLS policy (director/admin,
// blocked on archived seasons) — requireRole re-checks (Constitution I). The note
// is NON-health (Constitution III): vendor, serving time, pickup — never medical
// or dietary/allergy detail (that lives outside the system).

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function saveMealNote(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  // Ask for the row back. PostgREST answers a write that MATCHED NOTHING exactly
  // like one that succeeded — null error, no rows — and on this table RLS is the
  // real gate (competitions_write is director/admin and is closed on an archived
  // season). Without the row count, "Note saved." was said over a note that was
  // never written, and the caterer's pickup time went to the bus unchanged.
  const { data, error } = await supabase
    .from("competitions")
    .update({ meal_note: str(formData, "meal_note") || null })
    .eq("id", competitionId)
    .eq("program_id", programId)
    .select("id");

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce a protocol-relative "//evil.com/…", which
// every browser reads as a different ORIGIN and follows off-site. programPath
// validates the slug shape and fails closed to "/" (spec 005 T143a).
  const path = programPath(slug, `competitions/${competitionId}/meals`) ?? "/";
  const saved = !error && ((data as { id: string }[] | null) ?? []).length > 0;
  if (!saved) {
    redirect(`${path}?error=save`);
  }

  revalidatePath(path);
  // The app's one after-a-write message contract: `?ok=<key>` (lib/flash).
  redirect(`${path}?ok=saved`);
}
