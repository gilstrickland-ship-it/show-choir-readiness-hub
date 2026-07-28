"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  logTokenEvent,
  assertGuardianCapability,
  parentSurfaceAvailable,
  hashToken,
} from "@/lib/tokens";
import { checkTokenSurfaceLimit } from "@/lib/rate-limit";

// Guardian-token absence request (§8a). Guardian tokens ONLY. The write lands in
// the staff review queue (status='pending') — no parent-written state reaches
// attendance without staff eyes (Constitution II). Note field carries a standing
// no-health label (Constitution III); staff confirm/dismiss.
//
// The write re-checks the program's `competitions` flag itself (Constitution
// VIII): the page hiding the form is courtesy, not a gate.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return h.get("x-real-ip") ?? null;
}

function absencePath(token: string, status: string): string {
  return `/t/${token}/absence?s=${status}`;
}

export async function submitAbsence(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const studentId = str(formData, "studentId");
  const competitionId = str(formData, "competitionId");
  const note = str(formData, "note");

  const ip = await clientIp();
  if (!checkTokenSurfaceLimit({ ip, tokenHash: hashToken(token) }).ok) {
    redirect(absencePath(token, "ratelimited"));
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== "guardian") redirect(absencePath(token, "invalid"));
  assertGuardianCapability("absence:submit");
  // Flag-refused writes land on the absence page with no status code — that page
  // is the calm "not available" screen, which already says the true thing.
  if (!parentSurfaceAvailable(resolved.program, "absence")) {
    redirect(`/t/${token}/absence`);
  }

  // The student must belong to THIS family (allow-listed to own student(s)).
  const ownStudent = resolved.students.some((st) => st.id === studentId);
  if (!ownStudent || !competitionId) redirect(absencePath(token, "invalid"));

  const supabase = createAdminClient();

  // Scope the competition to the token's program.
  const { data: comp } = await supabase
    .from("competitions")
    .select("id")
    .eq("id", competitionId)
    .eq("program_id", resolved.program.id)
    .maybeSingle();
  if (!comp) redirect(absencePath(token, "invalid"));

  const { error } = await supabase.from("absence_requests").insert({
    program_id: resolved.program.id,
    competition_id: competitionId,
    student_id: studentId,
    guardian_id: resolved.guardian.id,
    note: note || null,
    status: "pending",
  });
  if (error) redirect(absencePath(token, "error"));

  await logTokenEvent({
    programId: resolved.program.id,
    kind: "guardian",
    tokenId: resolved.tokenId,
    action: "absence:submit",
    ip,
    supabase,
  });

  redirect(absencePath(token, "submitted"));
}
