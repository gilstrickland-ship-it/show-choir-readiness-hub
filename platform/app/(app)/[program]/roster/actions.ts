"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { rotateGuardianToken } from "@/lib/tokens";

// Roster mutations (students + guardians + size-field config). Writes are
// director/admin per §2 "Roster CRUD" — every action re-checks the role via
// requireRole (Constitution I, defense in depth) even though RLS also gates it.

const STUDENT_STATUSES = ["active", "inactive", "graduated"] as const;
type StudentStatus = (typeof STUDENT_STATUSES)[number];

// Read the program's configured size keys so `sizes` jsonb only ever holds keys
// the program defined (architecture-spec §3).
async function programSizeKeys(programId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("programs")
    .select("size_fields")
    .eq("id", programId)
    .maybeSingle();
  const keys = (data as { size_fields?: unknown } | null)?.size_fields;
  return Array.isArray(keys) ? (keys as string[]) : [];
}

// Build a sizes object from form fields named `size_<key>`, dropping blanks.
function readSizes(formData: FormData, keys: string[]): Record<string, string> {
  const sizes: Record<string, string> = {};
  for (const key of keys) {
    const v = String(formData.get(`size_${key}`) ?? "").trim();
    if (v) sizes[key] = v;
  }
  return sizes;
}

function parseGradYear(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export async function addStudent(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  if (!first || !last) {
    redirect(`/${slug}/roster?error=missing_name`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({
      program_id: programId,
      first_name: first,
      last_name: last,
      grad_year: parseGradYear(String(formData.get("grad_year") ?? "")),
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`/${slug}/roster?error=save`);
  }
  revalidatePath(`/${slug}/roster`);
  redirect(`/${slug}/roster/${data.id}?saved=1`);
}

export async function updateStudent(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const status = String(formData.get("status") ?? "active") as StudentStatus;
  if (!first || !last || !STUDENT_STATUSES.includes(status)) {
    redirect(`/${slug}/roster/${studentId}?error=missing_name`);
  }

  const keys = await programSizeKeys(programId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({
      first_name: first,
      last_name: last,
      grad_year: parseGradYear(String(formData.get("grad_year") ?? "")),
      status,
      sizes: readSizes(formData, keys),
    })
    .eq("id", studentId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=save`);
  }
  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(`/${slug}/roster/${studentId}?saved=1`);
}

// Soft delete (§9 invariant 1). NEVER hard-delete — ledger memos and archives
// may reference the student. Sets status='inactive' after releasing the roster
// row's downstream ties:
//   * costume_assignments deleted (pieces return to inventory) — RLS blocks
//     archived seasons, so only current + future season rows are removed.
//   * travel_assignments deleted (drops out of unassigned queues) — same
//     archived-season guard applies.
//   * attendance flipped to 'absent' for competitions dated today or later.
export async function deactivateStudent(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();

  // Release costume assignments (current + future seasons; archived rejected by RLS).
  await supabase
    .from("costume_assignments")
    .delete()
    .eq("program_id", programId)
    .eq("student_id", studentId);

  // Remove from travel groups (current + future; archived rejected by RLS).
  await supabase
    .from("travel_assignments")
    .delete()
    .eq("program_id", programId)
    .eq("student_id", studentId);

  // Flip attendance to absent for competitions dated today or later.
  const today = new Date().toISOString().slice(0, 10);
  const { data: comps } = await supabase
    .from("competitions")
    .select("id")
    .eq("program_id", programId)
    .gte("date", today);
  const compIds = ((comps as { id: string }[] | null) ?? []).map((c) => c.id);
  if (compIds.length > 0) {
    await supabase
      .from("attendance")
      .update({ status: "absent" })
      .eq("program_id", programId)
      .eq("student_id", studentId)
      .in("competition_id", compIds);
  }

  const { error } = await supabase
    .from("students")
    .update({ status: "inactive" })
    .eq("id", studentId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=deactivate`);
  }
  revalidatePath(`/${slug}/roster`);
  redirect(`/${slug}/roster/${studentId}?deactivated=1`);
}

// Re-activate an inactive student (no cascade — assignments are re-added by hand).
export async function reactivateStudent(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ status: "active" })
    .eq("id", studentId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=save`);
  }
  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(`/${slug}/roster/${studentId}?saved=1`);
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

export async function addGuardian(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/${slug}/roster/${studentId}?error=guardian`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("guardians").insert({
    program_id: programId,
    student_id: studentId,
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    relationship: String(formData.get("relationship") ?? "").trim() || null,
  });

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=guardian`);
  }
  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(`/${slug}/roster/${studentId}?saved=1`);
}

export async function updateGuardian(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const guardianId = String(formData.get("guardianId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/${slug}/roster/${studentId}?error=guardian`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("guardians")
    .update({
      name,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      relationship: String(formData.get("relationship") ?? "").trim() || null,
    })
    .eq("id", guardianId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=guardian`);
  }
  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(`/${slug}/roster/${studentId}?saved=1`);
}

export async function removeGuardian(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const guardianId = String(formData.get("guardianId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const { error } = await supabase
    .from("guardians")
    .delete()
    .eq("id", guardianId)
    .eq("program_id", programId);

  if (error) {
    redirect(`/${slug}/roster/${studentId}?error=guardian`);
  }
  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(`/${slug}/roster/${studentId}?saved=1`);
}

// ---------------------------------------------------------------------------
// Guardian tokenized links (§8a) — "generate / resend links"
// ---------------------------------------------------------------------------

// Mint a fresh guardian token (revoking any prior one — "resend links" rotates
// per §8a) and hand the raw token back to the page so staff can copy the three
// canonical links. The raw token is only knowable at mint time (hash-only at
// rest), so it rides back in the redirect for a one-time display on the staff's
// own screen. Director/admin only (guardian_tokens write gate).
export async function resendGuardianLinks(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const guardianId = String(formData.get("guardianId") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const result = await rotateGuardianToken(supabase, { programId, guardianId });
  if ("error" in result) {
    redirect(`/${slug}/roster/${studentId}?error=links`);
  }

  revalidatePath(`/${slug}/roster/${studentId}`);
  redirect(
    `/${slug}/roster/${studentId}?linked=${guardianId}&token=${encodeURIComponent(result.raw)}#guardians`,
  );
}

// ---------------------------------------------------------------------------
// Size-field config (programs.size_fields)
// ---------------------------------------------------------------------------

// Store the program's size keys. Input is a comma/newline-separated list; keys
// are normalized to lowercase alphanumeric+underscore, de-duped, order kept.
export async function updateSizeFields(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const raw = String(formData.get("size_fields") ?? "");
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const key = part.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  if (keys.length === 0) {
    redirect(`/${slug}/roster/settings?error=empty`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({ size_fields: keys })
    .eq("id", programId);

  if (error) {
    redirect(`/${slug}/roster/settings?error=save`);
  }
  revalidatePath(`/${slug}/roster/settings`);
  redirect(`/${slug}/roster/settings?saved=1`);
}
