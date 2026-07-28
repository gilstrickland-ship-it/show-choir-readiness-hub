"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Self-serve program creation (F1). A signed-in user with no program can create
// one and become its director in a single step. RLS can't cover this: there is
// no membership yet to authorize the INSERTs, so the service-role client writes
// both rows. The only authorization required is "is signed in" — creating a NEW
// program grants no access to anyone else's tenant.
//
// That last sentence is an invariant this action DEPENDS ON, not one it enforces:
// anyone can stand up a program here and be its director, so "director of the
// program named in this form" proves nothing about any OTHER program. Every write
// that accepts a row id from a client must therefore resolve that id inside its
// own program before trusting it (Constitution I) — a program_id column and a
// role check are not enough on their own.

// Turn a program name into a URL-safe slug. Falls back to "program" if the name
// has no slug-able characters (e.g. all punctuation).
function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "program";
}

// Find a slug not already taken, suffixing -2, -3, … on collision.
async function uniqueSlug(
  admin: ReturnType<typeof createAdminClient>,
  base: string,
): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await admin
      .from("programs")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // Extremely unlikely; fall back to a time-suffixed slug.
  return `${base}-${Date.now().toString(36)}`;
}

export async function createProgram(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();

  if (!name || !timezone) {
    redirect("/launch?error=missing");
  }

  const admin = createAdminClient();
  const slug = await uniqueSlug(admin, slugify(name));

  const { data: program, error: programError } = await admin
    .from("programs")
    .insert({
      name,
      slug,
      timezone,
      school_name: schoolName || null,
      city: city || null,
      state: state || null,
    })
    .select("id, slug")
    .single();

  if (programError || !program) {
    redirect("/launch?error=create");
  }

  const { error: memberError } = await admin.from("program_members").insert({
    program_id: program.id,
    user_id: user.id,
    role: "director",
    status: "active",
  });

  if (memberError) {
    // Roll back the orphaned program so a retry gets a clean slug.
    await admin.from("programs").delete().eq("id", program.id);
    redirect("/launch?error=create");
  }

  redirect(`/${program.slug}/dashboard`);
}
