import crypto from "node:crypto";

// Minimal svix webhook signature verification (Resend signs both its delivery
// and inbound webhooks with svix). No dependency: svix's scheme is a base64 HMAC-
// SHA256 over `${id}.${timestamp}.${body}` keyed by the decoded secret, emitted as
// a space-separated list of `v1,<sig>` in the svix-signature header.
//
// Callers SOFT-ACCEPT when no secret is configured (dev/pilot) and call this only
// when a secret is present — see each route's comment for why soft-accept is
// bounded-risk there.

export function verifySvix(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  body: string;
  signatureHeader: string | null;
}): boolean {
  const { secret, id, timestamp, body, signatureHeader } = args;
  if (!id || !timestamp || !signatureHeader) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  for (const part of signatureHeader.split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    try {
      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return true;
      }
    } catch {
      // length mismatch → not this signature; keep checking.
    }
  }
  return false;
}
