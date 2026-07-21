import { brand } from "@/lib/brand";

// Resend email sender (Constitution IX — from-name/address flow from brand
// config). The client is LAZY: constructed only when RESEND_API_KEY is present,
// so dev/pilot and build/verify run without email infra. When the key is
// absent, sends are marked 'skipped_no_key' by the caller and a banner surfaces
// the state — the platform stays fully usable without a mail provider.

let cachedClient: unknown | null = null;

// Escape LIKE/ILIKE metacharacters (`\`, `%`, `_`) so a value is matched
// LITERALLY by an ILIKE filter — turning ILIKE into a safe case-insensitive
// equality test. Without this, an address whose local part contains `_` or `%`
// (both legal in an email) would be read as a wildcard and widen the match.
// Used at every address-matching ILIKE site (Resend bounce/complaint webhook,
// the guardian unsubscribe, the invite lookup on /launch, and self-service link
// recovery) — PostgREST can't call lower() in a filter, so ILIKE + escaping is
// how we get case-insensitive exact matching.
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// The From header, e.g. "Boosters <no-reply@example.org>". Address from
// BRAND_EMAIL_FROM_ADDRESS or derived from the brand domain; name from brand.
export function emailFrom(): string {
  const address =
    process.env.BRAND_EMAIL_FROM_ADDRESS ?? `no-reply@${brand.domain}`;
  return `${brand.emailFromName} <${address}>`;
}

async function getClient(): Promise<{
  emails: { send: (args: unknown) => Promise<{ data: { id: string } | null; error: unknown }> };
} | null> {
  if (!emailConfigured()) return null;
  if (!cachedClient) {
    const { Resend } = await import("resend");
    cachedClient = new Resend(process.env.RESEND_API_KEY);
  }
  return cachedClient as never;
}

export type SendResult =
  | { status: "sent"; id: string | null }
  | { status: "skipped_no_key" }
  | { status: "failed"; error: string };

// Send one email. Never throws — returns a status the caller records on the
// per-send row so a single bad address never aborts a batch. Optional `headers`
// pass straight through to Resend — used for RFC 8058 List-Unsubscribe /
// List-Unsubscribe-Post one-click headers on every guardian-facing message.
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const client = await getClient();
  if (!client) return { status: "skipped_no_key" };

  try {
    const { data, error } = await client.emails.send({
      from: emailFrom(),
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.headers ? { headers: args.headers } : {}),
    });
    if (error) {
      return { status: "failed", error: String((error as { message?: string })?.message ?? error) };
    }
    return { status: "sent", id: data?.id ?? null };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
