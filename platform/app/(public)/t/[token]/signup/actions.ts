"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  logTokenEvent,
  assertGuardianCapability,
} from "@/lib/tokens";
import { checkTokenSurfaceLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";

// Guardian-token shift actions (§8a). Anonymous, service-role — the capability
// allow-list + program scoping are the security boundary. Every write:
//   1. rate-limits (per-IP + per-token, §10);
//   2. resolves the token and requires kind='guardian';
//   3. asserts the capability (shift:claim / shift:cancel);
//   4. scopes the shift to the token's program;
//   5. logs a token_event.
// Capacity: a claim is BLOCKED when confirmed signups already meet needed_count
// (friendly message) — no over-filling shifts through the parent surface.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return h.get("x-real-ip") ?? null;
}

function signupPath(token: string, status: string): string {
  return `/t/${token}/signup?s=${status}`;
}

export async function claimShift(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const shiftId = str(formData, "shiftId");

  const ip = await clientIp();
  if (!checkTokenSurfaceLimit({ ip, tokenHash: hashToken(token) }).ok) {
    redirect(signupPath(token, "ratelimited"));
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== "guardian") redirect(signupPath(token, "invalid"));
  assertGuardianCapability("shift:claim");

  const supabase = createAdminClient();

  // Scope the shift to the token's program.
  const { data: shiftData } = await supabase
    .from("shifts")
    .select("id, needed_count")
    .eq("id", shiftId)
    .eq("program_id", resolved.program.id)
    .maybeSingle();
  const shift = shiftData as { id: string; needed_count: number } | null;
  if (!shift) redirect(signupPath(token, "invalid"));

  const guardianId = resolved.guardian.id;

  // Does this guardian already have a row for the shift?
  const { data: existing } = await supabase
    .from("shift_signups")
    .select("id, status")
    .eq("program_id", resolved.program.id)
    .eq("shift_id", shift.id)
    .eq("guardian_id", guardianId)
    .maybeSingle();
  const existingRow = existing as { id: string; status: string } | null;

  if (existingRow?.status === "confirmed") {
    redirect(signupPath(token, "already"));
  }

  // Capacity: block when confirmed signups already meet needed_count.
  const { count } = await supabase
    .from("shift_signups")
    .select("id", { count: "exact", head: true })
    .eq("program_id", resolved.program.id)
    .eq("shift_id", shift.id)
    .eq("status", "confirmed");
  if ((count ?? 0) >= shift.needed_count) {
    redirect(signupPath(token, "full"));
  }

  if (existingRow) {
    await supabase
      .from("shift_signups")
      .update({ status: "confirmed", source: "token_link" })
      .eq("id", existingRow.id)
      .eq("program_id", resolved.program.id);
  } else {
    await supabase.from("shift_signups").insert({
      program_id: resolved.program.id,
      shift_id: shift.id,
      guardian_id: guardianId,
      name: resolved.guardian.name,
      email: resolved.guardian.email,
      status: "confirmed",
      source: "token_link",
    });
  }

  await logTokenEvent({
    programId: resolved.program.id,
    kind: "guardian",
    tokenId: resolved.tokenId,
    action: "shift:claim",
    ip,
    supabase,
  });

  redirect(signupPath(token, "claimed"));
}

export async function cancelShift(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const shiftId = str(formData, "shiftId");

  const ip = await clientIp();
  if (!checkTokenSurfaceLimit({ ip, tokenHash: hashToken(token) }).ok) {
    redirect(signupPath(token, "ratelimited"));
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== "guardian") redirect(signupPath(token, "invalid"));
  assertGuardianCapability("shift:cancel");

  const supabase = createAdminClient();

  // Cancel only the guardian's OWN signup, scoped to program + shift.
  await supabase
    .from("shift_signups")
    .update({ status: "cancelled" })
    .eq("program_id", resolved.program.id)
    .eq("shift_id", shiftId)
    .eq("guardian_id", resolved.guardian.id);

  await logTokenEvent({
    programId: resolved.program.id,
    kind: "guardian",
    tokenId: resolved.tokenId,
    action: "shift:cancel",
    ip,
    supabase,
  });

  redirect(signupPath(token, "cancelled"));
}
