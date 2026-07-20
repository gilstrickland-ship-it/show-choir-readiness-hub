import { applyUnsubscribe } from "../unsubscribe-core";

// RFC 8058 one-click unsubscribe (§8a, C1-4). This is the URL carried in the
// List-Unsubscribe / List-Unsubscribe-Post headers of every guardian-facing
// email. Mailbox providers POST here (no body, no user interaction) when the
// recipient taps their client's native "Unsubscribe". POST-only, rate-limited
// (in applyUnsubscribe), returns 200 plain text as the spec requires. It always
// answers 200 — even for an invalid/expired token — so providers never surface a
// scary error and we reveal no token structure.

export const runtime = "nodejs";

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  await applyUnsubscribe(token, clientIp(req));
  return new Response("You have been unsubscribed.", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
