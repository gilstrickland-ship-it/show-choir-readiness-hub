"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ROSTER_WRITE_ROLES } from "@/lib/nav";
import { parseRosterCsv, DEFAULT_SIZE_KEYS, type ParseResult } from "@/lib/roster/import";

// Combined CSV import — server actions (T008). Both preview and commit re-parse
// the raw text server-side using the program's own size keys, so the commit
// never trusts client-modified rows. director/admin only (§2 Roster CRUD).

export interface PreviewResult extends ParseResult {
  sizeKeys: string[];
}

async function sizeKeysFor(programId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("programs")
    .select("size_fields")
    .eq("id", programId)
    .maybeSingle();
  const keys = (data as { size_fields?: unknown } | null)?.size_fields;
  return Array.isArray(keys) && keys.length > 0 ? (keys as string[]) : [...DEFAULT_SIZE_KEYS];
}

// Parse-only: no writes. Returns the preview (valid rows, per-row errors, and
// the skipped health-column notice).
export async function previewImport(
  programId: string,
  text: string,
): Promise<PreviewResult> {
  await requireRole(programId, ROSTER_WRITE_ROLES);
  const sizeKeys = await sizeKeysFor(programId);
  const parsed = parseRosterCsv(text, sizeKeys);
  return { ...parsed, sizeKeys };
}

export interface CommitResult {
  studentsCreated: number;
  guardiansCreated: number;
  errorCount: number;
  ok: boolean;
  message?: string;
}

// Commit: re-parse and insert valid students + their guardians. Sequenced per
// student (insert student → insert its guardians) so guardian rows always link
// to a real student id; a partial failure stops and reports what landed.
export async function commitImport(
  programId: string,
  text: string,
): Promise<CommitResult> {
  await requireRole(programId, ROSTER_WRITE_ROLES);
  const sizeKeys = await sizeKeysFor(programId);
  const { rows, errors } = parseRosterCsv(text, sizeKeys);

  const supabase = await createClient();
  let studentsCreated = 0;
  let guardiansCreated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const { data: student, error: studentErr } = await supabase
      .from("students")
      .insert({
        program_id: programId,
        first_name: row.firstName,
        last_name: row.lastName,
        grad_year: row.gradYear,
        sizes: row.sizes,
        status: "active",
      })
      .select("id")
      .single();

    if (studentErr || !student) {
      // Raw Postgres detail is for the logs only — the user gets plain guidance.
      console.error(
        `Roster import: student insert failed on row ${rowNum}:`,
        studentErr?.message ?? "no row returned",
      );
      return {
        studentsCreated,
        guardiansCreated,
        errorCount: errors.length,
        ok: false,
        message: `Row ${rowNum} couldn't be saved — it may duplicate an existing student. Stopped after importing ${studentsCreated}.`,
      };
    }
    studentsCreated += 1;

    if (row.guardians.length > 0) {
      const { error: guardianErr } = await supabase.from("guardians").insert(
        row.guardians.map((g) => ({
          program_id: programId,
          student_id: student.id,
          name: g.name,
          email: g.email,
          phone: g.phone,
          relationship: g.relationship,
        })),
      );
      if (guardianErr) {
        console.error(
          `Roster import: guardian insert failed on row ${rowNum}:`,
          guardianErr.message,
        );
        return {
          studentsCreated,
          guardiansCreated,
          errorCount: errors.length,
          ok: false,
          message: `Students imported, but a guardian on row ${rowNum} couldn't be saved — check that row's guardian email addresses.`,
        };
      }
      guardiansCreated += row.guardians.length;
    }
  }

  return {
    studentsCreated,
    guardiansCreated,
    errorCount: errors.length,
    ok: true,
    message: `Imported ${studentsCreated} students and ${guardiansCreated} guardians.`,
  };
}
