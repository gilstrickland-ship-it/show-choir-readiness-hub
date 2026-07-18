import { cache } from "react";
import { headers } from "next/headers";
import { resolveToken, hashToken, type ResolvedToken } from "@/lib/tokens";
import { checkTokenSurfaceLimit } from "@/lib/rate-limit";

// Request-scoped helpers for the anonymous (public)/t/ surface. The token is
// resolved once per request via React cache() (the layout and the page both call
// getResolvedToken with the same raw token, so the service-role lookup runs
// once). Rate limiting + the 'view' audit log run in the layout.

// Resolve the raw token to a family/resource, deduped within a request render.
export const getResolvedToken = cache(
  async (raw: string): Promise<ResolvedToken> => resolveToken(raw),
);

// Best-effort client IP from the standard proxy headers. Null when unknown — the
// rate limiter still applies the per-token budget.
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? null;
}

// Apply the per-IP + per-token sliding-window budget for a raw token. Keyed on
// the token HASH (never the raw token) so the limiter store holds no secrets.
export function rateLimitRawToken(ip: string | null, raw: string) {
  return checkTokenSurfaceLimit({ ip, tokenHash: hashToken(raw) });
}
