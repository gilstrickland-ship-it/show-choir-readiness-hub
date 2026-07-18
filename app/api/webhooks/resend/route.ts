import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySvix } from "@/lib/svix";

// Resend deliverability webhook (§8a, T026). Bounce / complaint / unsubscribe
// events flow here and update guardians.email_status so computeRecipients stops
// mailing bad or opted-out addresses (which already filters to 'ok').
//
// SIGNATURE: Resend signs webhooks with svix. When RESEND_WEBHOOK_SECRET is set we
// verify the svix signature; when it is absent we SOFT-ACCEPT (dev/pilot works
// without the secret) — the effect of a forged event is bounded (it can only mark
// an address bounced/unsubscribed, never read data), so soft-accept is acceptable
// pre-configuration and logged.
//
// SCOPE: a bounce/complaint is a property of the EMAIL ADDRESS, not of one
// program, so we update EVERY guardian row carrying that address across all
// programs (an address that hard-bounces is dead everywhere). This is intentional.

export const runtime = "nodejs";

// Pull candidate recipient emails out of a Resend event payload. `to` may be a
// string or an array; `email` is sometimes present too.
function extractEmails(data: unknown): string[] {
  const out = new Set<string>();
  const d = (data ?? {}) as Record<string, unknown>;
  const push = (v: unknown) => {
    if (typeof v === "string" && v.includes("@")) out.add(v.trim().toLowerCase());
  };
  if (Array.isArray(d.to)) d.to.forEach(push);
  else push(d.to);
  push(d.email);
  return Array.from(out);
}

// Map a Resend event type → the guardian email_status it implies, or null to
// ignore (delivered/sent/opened/etc. are not status changes).
function statusForEvent(type: string): "bounced" | "unsubscribed" | null {
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "unsubscribed"; // spam complaint → stop mailing
  if (type.includes("unsubscribe")) return "unsubscribed";
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const ok = verifySvix({
      secret,
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      body,
      signatureHeader: req.headers.get("svix-signature"),
    });
    if (!ok) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let payload: { type?: string; data?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type = payload.type ?? "";
  const newStatus = statusForEvent(type);
  if (!newStatus) {
    // Not a deliverability status change — acknowledge and ignore.
    return NextResponse.json({ ok: true, ignored: type });
  }

  const emails = extractEmails(payload.data);
  if (emails.length === 0) {
    return NextResponse.json({ ok: true, matched: 0 });
  }

  const supabase = createAdminClient();
  // Match by email (address-global). Never downgrade an 'unsubscribed' back to
  // 'bounced' — an explicit opt-out is stronger; only overwrite when moving TO
  // unsubscribed, or when currently 'ok'.
  let matched = 0;
  for (const email of emails) {
    const query = supabase.from("guardians").update({ email_status: newStatus });
    // Case-insensitive match on the stored address.
    const { data, error } = await query
      .ilike("email", email)
      .neq("email_status", "unsubscribed")
      .select("id");
    if (!error && data) matched += (data as { id: string }[]).length;
  }

  return NextResponse.json({ ok: true, status: newStatus, matched });
}
