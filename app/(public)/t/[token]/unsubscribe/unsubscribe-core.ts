import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveToken,
  hashToken,
  logTokenEvent,
  assertGuardianCapability,
} from "@/lib/tokens";
import { escapeLike } from "@/lib/email";
import { checkTokenSurfaceLimit } from "@/lib/rate-limit";

// Shared unsubscribe core (§8a, C1-4). ONE implementation behind both surfaces at
// the same conceptual path: the human confirm PAGE's server action and the RFC
// 8058 one-click POST route (which lives at .../unsubscribe/one-click because
// Next.js can't host a page and a route handler on the same path). Plain module
// (not "use server") so the route handler can import it directly.
//
// Guardian tokens ONLY (the capability allow-list is the boundary; share links
// have no email to stop). Rate-limited like every other token write. Coherent
// with the Resend webhook (app/api/webhooks/resend): both set the SAME
// guardians.email_status='unsubscribed' value that computeRecipients filters out,
// and staff resubscribe from the student page ("Mark deliverable again" → 'ok').

export type UnsubResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "ratelimited" | "invalid" };

export async function applyUnsubscribe(
  token: string,
  ip: string | null,
): Promise<UnsubResult> {
  if (!checkTokenSurfaceLimit({ ip, tokenHash: hashToken(token) }).ok) {
    return { ok: false, reason: "ratelimited" };
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== "guardian") {
    return { ok: false, reason: "invalid" };
  }
  assertGuardianCapability("email:unsubscribe");

  const supabase = createAdminClient();
  const email = resolved.guardian.email;

  // Program-scoped opt-out: mark every guardian row in THIS program that shares
  // the address (a family has one row per child) as unsubscribed. An opt-out from
  // one program never touches another program's list. When the address is null we
  // can only scope to this single guardian row.
  if (email) {
    await supabase
      .from("guardians")
      .update({ email_status: "unsubscribed" })
      .eq("program_id", resolved.program.id)
      .ilike("email", escapeLike(email));
  } else {
    await supabase
      .from("guardians")
      .update({ email_status: "unsubscribed" })
      .eq("id", resolved.guardian.id)
      .eq("program_id", resolved.program.id);
  }

  await logTokenEvent({
    programId: resolved.program.id,
    kind: "guardian",
    tokenId: resolved.tokenId,
    action: "email:unsubscribe",
    ip,
    supabase,
  });

  return { ok: true, email };
}
