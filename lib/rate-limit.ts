// ============================================================================
// §10 Token-surface rate limiting — per-IP and per-token sliding window.
// ----------------------------------------------------------------------------
// In-memory sliding-window limiter for the anonymous (public)/t/ routes. Keeps a
// timestamp list per key and counts hits inside the trailing window.
//
// SINGLE-INSTANCE ONLY. This lives in process memory, so it protects one server
// instance; a multi-instance production deployment (Vercel functions) must swap
// this for a shared store — Upstash Redis (@upstash/ratelimit) is the intended
// replacement, keyed identically (per-IP and per-token). The call sites below
// would not change; only this module's internals would.
//
// Pure/self-contained (no DB, no env) so it is deterministic and testable.
// ============================================================================

interface WindowState {
  hits: number[]; // epoch-ms timestamps within the window
}

const store = new Map<string, WindowState>();

// Bound memory: opportunistically drop empty keys when the map grows.
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

// Record a hit for `key` and report whether it is within `limit` per `windowMs`.
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const state = store.get(key) ?? { hits: [] };

  // Drop timestamps that have aged out of the window.
  const recent = state.hits.filter((t) => t > cutoff);

  if (recent.length >= limit) {
    // Over limit — do NOT record this hit; report when the oldest hit expires.
    state.hits = recent;
    store.set(key, state);
    const oldest = recent[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    };
  }

  recent.push(now);
  state.hits = recent;
  store.set(key, state);

  if (store.size > MAX_KEYS) sweep(cutoff);

  return { ok: true, remaining: limit - recent.length, retryAfterMs: 0 };
}

function sweep(cutoff: number): void {
  for (const [key, state] of store) {
    const recent = state.hits.filter((t) => t > cutoff);
    if (recent.length === 0) store.delete(key);
    else state.hits = recent;
  }
}

// Default token-surface budgets (§10): 60 req/min per IP, 30 req/min per token.
export const IP_LIMIT = 60;
export const TOKEN_LIMIT = 30;
export const WINDOW_MS = 60_000;

// Apply both the per-IP and per-token budgets. Over either → not ok. `ip` may be
// null (unknown) — we still limit per token.
export function checkTokenSurfaceLimit(args: {
  ip: string | null;
  tokenHash: string;
  now?: number;
}): RateLimitResult {
  const now = args.now ?? Date.now();
  const tokenResult = checkRateLimit(
    `token:${args.tokenHash}`,
    TOKEN_LIMIT,
    WINDOW_MS,
    now,
  );
  const ipResult = args.ip
    ? checkRateLimit(`ip:${args.ip}`, IP_LIMIT, WINDOW_MS, now)
    : { ok: true, remaining: IP_LIMIT, retryAfterMs: 0 };

  if (!tokenResult.ok) return tokenResult;
  if (!ipResult.ok) return ipResult;
  return {
    ok: true,
    remaining: Math.min(tokenResult.remaining, ipResult.remaining),
    retryAfterMs: 0,
  };
}

// Test-only reset.
export function __resetRateLimit(): void {
  store.clear();
}
