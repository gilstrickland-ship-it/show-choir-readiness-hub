"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { programPath } from "@/lib/return-path";
import { rotateGuardianToken } from "@/lib/tokens";
import { sendGuardianLinksEmail } from "@/lib/comms-send";
import { computeRecipients } from "@/lib/comms";
import { zonedDateKey } from "@/lib/datetime";
import {
  STUDENT_STATUSES,
  guardianAnchor,
  isStudentSection,
  type StudentStatus,
} from "@/lib/roster/students";

// Roster mutations (students + guardians + size-field config). Writes are
// director/admin per §2 "Roster CRUD" — every action re-checks the role via
// requireRole (Constitution I, defense in depth) even though RLS also gates it.
// costume_manager and treasurer have no roster seat at all, read or write.
//
// CROSS-PROGRAM REFERENCES (Constitution I). studentId and guardianId arrive as
// form fields, and requireRole only proves the caller runs THIS program — not
// that the row they posted belongs to it. Anyone can self-serve a program at
// /launch, so every id is resolved inside programId before anything is written,
// and an unresolved id fails closed to the surface's error convention instead of
// reporting a save that never happened.

// Fail closed on the slug: it arrives as a form field, and a value like
// "/evil.com" interpolated into a path makes a protocol-relative URL the browser
// follows off-site (lib/return-path). Anything that isn't a program slug lands
// on "/" rather than building a target out of it.
function rosterPath(slug: string, sub?: string): string {
  return programPath(slug, sub ? `roster/${sub}` : "roster") ?? "/";
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function nullable(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

// A section-local edit posts ONLY the fields it shows, plus `sparse=1`. Absent
// means "leave it alone" — correcting a size must not clear a grad year, and
// deactivating from the Status group must not rewrite the name.
function isSparse(fd: FormData): boolean {
  return str(fd, "sparse") === "1";
}

// Which group of the student page posted, so a save (or a refusal) lands back on
// it. Allow-listed — the value rides into a URL fragment.
function sectionHash(fd: FormData): string {
  const section = str(fd, "section");
  return isStudentSection(section) ? `#${section}` : "";
}

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

// ---- Cross-program resolvers -----------------------------------------------

async function studentInProgram(
  supabase: SupabaseClient,
  programId: string,
  studentId: string,
): Promise<boolean> {
  if (!studentId) return false;
  const { data } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("program_id", programId)
    .maybeSingle();
  return Boolean(data);
}

// The guardian row when it belongs to this program, null otherwise. Returns the
// email too, because the send path needs it and one read is enough.
async function guardianInProgram(
  supabase: SupabaseClient,
  programId: string,
  guardianId: string,
): Promise<{ id: string; email: string | null } | null> {
  if (!guardianId) return null;
  const { data } = await supabase
    .from("guardians")
    .select("id, email")
    .eq("id", guardianId)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as { id: string; email: string | null } | null) ?? null;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export async function addStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const first = str(formData, "first_name");
  const last = str(formData, "last_name");
  if (!first || !last) {
    redirect(`${rosterPath(slug)}?error=missing_name`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({
      program_id: programId,
      first_name: first,
      last_name: last,
      grad_year: parseGradYear(str(formData, "grad_year")),
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`${rosterPath(slug)}?error=save`);
  }
  revalidatePath(rosterPath(slug));
  redirect(`${rosterPath(slug, String(data.id))}?saved=1`);
}

// One action behind the student page's three groups (Profile · Sizes · Status).
// Each group posts only its own fields plus `sparse=1`, so the fields it does
// not show survive untouched; a save without `sparse` (nothing renders one
// today) still writes the whole record, exactly as this action always did.
export async function updateStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const detail = rosterPath(slug, studentId);
  const hash = sectionHash(formData);
  const fail = (code: string): string => `${detail}?error=${code}${hash}`;

  const sparse = isSparse(formData);
  const sends = (key: string): boolean => !sparse || formData.get(key) !== null;

  const first = str(formData, "first_name");
  const last = str(formData, "last_name");
  const status = str(formData, "status") as StudentStatus;
  if (sends("first_name") && !first) redirect(fail("missing_name"));
  if (sends("last_name") && !last) redirect(fail("missing_name"));
  if (sends("status") && !STUDENT_STATUSES.includes(status)) redirect(fail("save"));

  const fields: Record<string, unknown> = {};
  if (sends("first_name")) fields.first_name = first;
  if (sends("last_name")) fields.last_name = last;
  if (sends("grad_year")) fields.grad_year = parseGradYear(str(formData, "grad_year"));
  if (sends("status")) fields.status = status;
  // The Sizes group posts `sizes=1` plus one input per configured key, and the
  // whole map is rewritten from those inputs — a key the program has since
  // dropped must not survive as a stale value nobody can see or clear.
  if (!sparse || str(formData, "sizes") === "1") {
    fields.sizes = readSizes(formData, await programSizeKeys(programId));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update(fields)
    .eq("id", studentId)
    .eq("program_id", programId);

  if (error) redirect(fail("save"));
  revalidatePath(detail);
  redirect(`${detail}?saved=1${hash}`);
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
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const detail = rosterPath(slug, studentId);
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

  // Flip attendance to absent for competitions dated today or later — where
  // "today" is the PROGRAM's today. `competitions.date` is a plain calendar day,
  // and a UTC key reads as tomorrow every Central evening, so a student
  // withdrawn after 6pm on the eve of a competition stayed 'expected' for it —
  // on the very day the director was counting heads.
  const { data: progRow } = await supabase
    .from("programs")
    .select("timezone")
    .eq("id", programId)
    .maybeSingle();
  const tz = (progRow as { timezone: string } | null)?.timezone ?? "UTC";
  const today = zonedDateKey(new Date(), tz);
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
    redirect(`${detail}?error=deactivate#status`);
  }
  revalidatePath(rosterPath(slug));
  redirect(`${detail}?deactivated=1#status`);
}

// Re-activate an inactive student (no cascade — assignments are re-added by hand).
export async function reactivateStudent(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const detail = rosterPath(slug, studentId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ status: "active" })
    .eq("id", studentId)
    .eq("program_id", programId);

  if (error) {
    redirect(`${detail}?error=save#status`);
  }
  revalidatePath(detail);
  redirect(`${detail}?saved=1#status`);
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

// Everything a guardian action can refuse lands back on the Guardians group;
// everything that belongs to ONE row also reopens that row's Edit panel, so the
// message appears inside the panel that produced it.
function guardiansFail(slug: string, studentId: string, code: string): string {
  return `${rosterPath(slug, studentId)}?error=${code}#guardians`;
}

function guardianFail(
  slug: string,
  studentId: string,
  guardianId: string,
  code: string,
): string {
  return `${rosterPath(slug, studentId)}?error=${code}&edit=${encodeURIComponent(
    guardianId,
  )}#${guardianAnchor(guardianId)}`;
}

export async function addGuardian(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) {
    redirect(`${guardiansFail(slug, studentId, "guardian")}`);
  }

  const supabase = await createClient();

  // studentId arrives from the form, and the row's own program_id is all the
  // write policy checks — so resolve the student inside THIS program before
  // attaching contact details to them (Constitution I). A miss means the student
  // isn't ours; send staff back to the roster rather than to a page that would
  // not render for them either.
  if (!(await studentInProgram(supabase, programId, studentId))) {
    redirect(`${rosterPath(slug)}?error=student`);
  }

  const { error } = await supabase.from("guardians").insert({
    program_id: programId,
    student_id: studentId,
    name,
    email: nullable(formData, "email"),
    phone: nullable(formData, "phone"),
    relationship: nullable(formData, "relationship"),
  });

  if (error) {
    redirect(guardiansFail(slug, studentId, "guardian"));
  }
  revalidatePath(rosterPath(slug, studentId));
  redirect(`${rosterPath(slug, studentId)}?saved=1#guardians`);
}

export async function updateGuardian(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  const guardianId = str(formData, "guardianId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const name = str(formData, "name");
  if (!name) {
    redirect(guardianFail(slug, studentId, guardianId, "guardian"));
  }

  const supabase = await createClient();
  if (!(await guardianInProgram(supabase, programId, guardianId))) {
    redirect(guardiansFail(slug, studentId, "guardian_gone"));
  }

  const { error } = await supabase
    .from("guardians")
    .update({
      name,
      email: nullable(formData, "email"),
      phone: nullable(formData, "phone"),
      relationship: nullable(formData, "relationship"),
    })
    .eq("id", guardianId)
    .eq("program_id", programId);

  if (error) {
    redirect(guardianFail(slug, studentId, guardianId, "guardian"));
  }
  revalidatePath(rosterPath(slug, studentId));
  redirect(`${rosterPath(slug, studentId)}?saved=1#guardians`);
}

// Resubscribe / clear a deliverability flag: flip a guardian's email_status back
// to 'ok' so announcement + digest sends reach them again. The path back from a
// bounce the director has fixed, or from an unsubscribe the family asked to
// reverse — coherent with the Resend webhook (which sets bounced/unsubscribed)
// and the guardian unsubscribe page. Director/admin only.
export async function resetGuardianEmailStatus(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  const guardianId = str(formData, "guardianId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await guardianInProgram(supabase, programId, guardianId))) {
    redirect(guardiansFail(slug, studentId, "guardian_gone"));
  }

  const { error } = await supabase
    .from("guardians")
    .update({ email_status: "ok" })
    .eq("id", guardianId)
    .eq("program_id", programId);

  if (error) {
    redirect(guardianFail(slug, studentId, guardianId, "guardian"));
  }
  revalidatePath(rosterPath(slug, studentId));
  redirect(`${rosterPath(slug, studentId)}?saved=1#guardians`);
}

export async function removeGuardian(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  const guardianId = str(formData, "guardianId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await guardianInProgram(supabase, programId, guardianId))) {
    redirect(guardiansFail(slug, studentId, "guardian_gone"));
  }

  const { error } = await supabase
    .from("guardians")
    .delete()
    .eq("id", guardianId)
    .eq("program_id", programId);

  if (error) {
    redirect(guardianFail(slug, studentId, guardianId, "guardian"));
  }
  revalidatePath(rosterPath(slug, studentId));
  redirect(`${rosterPath(slug, studentId)}?saved=1#guardians`);
}

// ---------------------------------------------------------------------------
// Guardian tokenized links (§8a)
// ---------------------------------------------------------------------------

async function programName(
  supabase: SupabaseClient,
  programId: string,
): Promise<string> {
  const { data } = await supabase
    .from("programs")
    .select("name")
    .eq("id", programId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? "";
}

// SEND FAMILY LINKS — the one per-guardian send, and the row's first affordance.
// It mints a FRESH token (append-only, so links from earlier emails keep
// working) and emails this program's parent links to one guardian. This is the
// everyday "get the family into the system" path. Graceful no-key mode: when
// email isn't configured the send is 'skipped_no_key' and the page shows the
// freshly-minted links so staff can copy them into a message instead.
// Director/admin only.
//
// Wave 6 folded the row's two send buttons into this one. `emailGuardianLinks`
// (this behaviour) and `resendGuardianLinks` (revoke-then-mint) read as
// synonyms in the actions file and on the row, so the everyday send now owns the
// only send label and the revoke path moved inside Edit under a name that isn't
// one — resetFamilyLinks, below. Neither body changed: what is minted, what is
// revoked, and what the parent surface can resolve are exactly what they were.
export async function sendFamilyLinks(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  const guardianId = str(formData, "guardianId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const guardian = await guardianInProgram(supabase, programId, guardianId);
  if (!guardian) {
    redirect(guardiansFail(slug, studentId, "guardian_gone"));
  }

  const email = (guardian.email ?? "").trim();
  if (!email) {
    redirect(guardianFail(slug, studentId, guardianId, "email_missing"));
  }

  const { send, raw } = await sendGuardianLinksEmail(supabase, {
    programId,
    guardianId,
    email,
    programName: await programName(supabase, programId),
  });

  const detail = rosterPath(slug, studentId);
  revalidatePath(detail);
  if (send.status === "sent") {
    redirect(`${detail}?emailed=ok#guardians`);
  }
  if (send.status === "skipped_no_key" && raw) {
    // No mail provider — surface the freshly-minted (append-only) links so staff
    // can copy them into a message. These links WORK; earlier links still work too.
    redirect(
      `${detail}?emailed=nokey&token=${encodeURIComponent(raw)}#guardians`,
    );
  }
  redirect(guardianFail(slug, studentId, guardianId, "email"));
}

// RESET THIS FAMILY'S LINKS — mint a fresh guardian token AND revoke every prior
// one, handing the raw token back to the page for a one-time on-screen display
// so staff can copy the canonical links. This BREAKS every link previously
// sent to this family, which is the point: it is the answer to "an email was
// forwarded outside the family". It is not a send, so it does not sit on the row
// next to one — it lives inside Edit behind a confirm.
//
// The raw token is only knowable at mint time (hash-only at rest), so it rides
// back in the redirect. Director/admin only (guardian_tokens write gate).
// guardianId comes off the form; it is resolved in-program here and again inside
// mintGuardianToken, so a tampered id mints nothing.
export async function resetFamilyLinks(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const studentId = str(formData, "studentId");
  const guardianId = str(formData, "guardianId");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  if (!(await guardianInProgram(supabase, programId, guardianId))) {
    redirect(guardiansFail(slug, studentId, "guardian_gone"));
  }

  const result = await rotateGuardianToken(supabase, { programId, guardianId });
  if ("error" in result) {
    redirect(guardianFail(slug, studentId, guardianId, "links"));
  }

  const detail = rosterPath(slug, studentId);
  revalidatePath(detail);
  redirect(
    `${detail}?token=${encodeURIComponent(result.raw)}#guardians`,
  );
}

// BULK EMAIL LINKS TO ALL FAMILIES: for every guardian with email_status='ok'
// (deduped per family by computeRecipients — one message per household), mint a
// fresh token and email their links. Reports sent / skipped / failed counts.
// No-key mode reports every recipient as skipped. Director/admin only.
export async function emailAllGuardianLinks(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const supabase = await createClient();
  const name = await programName(supabase, programId);

  const recipients = await computeRecipients(supabase, {
    programId,
    seasonId: null,
    ensembleId: null,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of recipients) {
    const { send } = await sendGuardianLinksEmail(supabase, {
      programId,
      guardianId: r.guardianId,
      email: r.email,
      programName: name,
    });
    if (send.status === "sent") sent++;
    else if (send.status === "skipped_no_key") skipped++;
    else failed++;
  }

  revalidatePath(rosterPath(slug));
  redirect(`${rosterPath(slug)}?bulk=${sent}.${skipped}.${failed}`);
}

// ---------------------------------------------------------------------------
// Size-field config (programs.size_fields)
// ---------------------------------------------------------------------------

// Store the program's size keys. Input is a comma/newline-separated list; keys
// are normalized to lowercase alphanumeric+underscore, de-duped, order kept.
export async function updateSizeFields(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  await requireRole(programId, ROSTER_WRITE_ROLES);

  const settings = rosterPath(slug, "settings");
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
    redirect(`${settings}?error=empty`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({ size_fields: keys })
    .eq("id", programId);

  if (error) {
    redirect(`${settings}?error=save`);
  }
  revalidatePath(settings);
  redirect(`${settings}?saved=1`);
}
