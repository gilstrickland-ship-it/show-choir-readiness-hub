"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/tokens";
import { sendGuardianLinksEmail } from "@/lib/comms-send";
import { escapeLike } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

// Self-service link recovery (§8a, C2-3). A parent who deleted the email has no
// account to log into (Constitution II) and previously dead-ended at "contact the
// program". This lets them ask for fresh family links by email — WITHOUT ever
// revealing whether the address is on any list (enumeration-safe): the outcome is
// byte-identical for a match, a miss, and a rate-limited submit.
//
// It mints nothing beyond what sendGuardianLinksEmail already does (one fresh
// append-only token per program membership, exactly like "Resend links"). No
// token is in scope here — this runs from a plain public page, not a /t/ route.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return h.get("x-real-ip") ?? null;
}

// Hard, dedicated budgets (independent of the token-surface limiter): tight
// enough that this can't be used to probe the contact list at scale.
const RECOVERY_WINDOW_MS = 15 * 60_000; // 15 minutes
const RECOVERY_IP_LIMIT = 8;
const RECOVERY_EMAIL_LIMIT = 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The completion message is the SAME on every path. The page shows it on ?sent=1.
function done(): never {
  redirect("/link-help?sent=1");
}

export async function recoverLinks(formData: FormData): Promise<void> {
  const email = str(formData, "email").toLowerCase();

  // Silently succeed on garbage input too — never a different response.
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) done();

  // Rate-limit HARD: per-IP and per-submitted-email. The email is keyed by hash
  // so the limiter store never holds the raw address (no secrets in the limiter).
  const ip = await clientIp();
  const emailKey = `recover-email:${hashToken(email)}`;
  const ipOk = ip
    ? checkRateLimit(`recover-ip:${ip}`, RECOVERY_IP_LIMIT, RECOVERY_WINDOW_MS).ok
    : true;
  const emailOk = checkRateLimit(emailKey, RECOVERY_EMAIL_LIMIT, RECOVERY_WINDOW_MS).ok;
  if (!ipOk || !emailOk) done(); // same completion message — never reveal the limit.

  try {
    const supabase = createAdminClient();

    // Case-insensitive EXACT match. We do NOT interpolate the address into an
    // ilike pattern (a submitted `_`/`%` would become a wildcard and widen the
    // match); PostgREST can't call lower() in a filter, so we escape every LIKE
    // metacharacter, which turns ilike into a safe case-insensitive equality.
    const likeExact = escapeLike(email);
    const { data: rows } = await supabase
      .from("guardians")
      .select("id, program_id, email_status")
      .eq("email_status", "ok")
      .ilike("email", likeExact);

    const guardians =
      (rows as { id: string; program_id: string; email_status: string }[] | null) ?? [];

    // One email per DISTINCT program membership (a family with two kids has two
    // guardian rows in one program → still one email). Any guardian row for the
    // program works: its minted token resolves to the whole family.
    const byProgram = new Map<string, string>(); // program_id → guardian_id
    for (const g of guardians) {
      if (!byProgram.has(g.program_id)) byProgram.set(g.program_id, g.id);
    }

    for (const [programId, guardianId] of byProgram) {
      const { data: prog } = await supabase
        .from("programs")
        .select("name")
        .eq("id", programId)
        .maybeSingle();
      const programName = (prog as { name: string } | null)?.name ?? "your program";
      // Best-effort — sendGuardianLinksEmail never throws; a skip/failure on one
      // program must not change the outcome for the parent or reveal anything.
      await sendGuardianLinksEmail(supabase, {
        programId,
        guardianId,
        email, // the parent's own address, only as the send target.
        programName,
      });
    }
  } catch {
    // Swallow — the response is identical regardless of what happened server-side.
  }

  done();
}
