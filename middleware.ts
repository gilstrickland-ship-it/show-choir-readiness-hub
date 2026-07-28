import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { checkRateLimit, IP_LIMIT, WINDOW_MS } from "@/lib/rate-limit";
import {
  isNoIndexPath,
  NOINDEX_HEADER,
  NOINDEX_VALUE,
} from "@/lib/no-index";

// Session refresh per the @supabase/ssr middleware pattern. Runs on every
// matched request: rehydrates the Supabase auth cookie so server components and
// actions always see a fresh session. Does NOT gate routes itself — page-level
// getTenantContext()/requireRole() own authorization (Constitution I, defense in
// depth). Keep this lean: any logic between createServerClient and getUser risks
// hard-to-debug logout bugs.
//
// §10 hardening (T039): the tokenized parent surface (/t/…) is anonymous and RSC,
// so a page CANNOT set an HTTP status — a real 429 has to come from here. We
// enforce the PER-IP budget in middleware and return a genuine 429 Response when
// it is exceeded. The PER-TOKEN budget stays in the /t/ layout, which renders a
// friendly in-page "slow down" message (an RSC can render, just not set status).
// Split rationale: coarse abuse (one IP hammering many tokens) is stopped hard at
// the edge with a real status code; a single family over-refreshing their own
// link gets a gentle, human message instead of a wall. NOTE: this limiter is
// in-memory and PER-INSTANCE (documented in lib/rate-limit.ts) — swap for a
// shared store (Upstash) in a multi-instance deployment.
function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

export async function middleware(request: NextRequest) {
  const noIndex = isNoIndexPath(request.nextUrl.pathname);

  // Real 429 for the anonymous token surface, per-IP (§10, T039).
  if (noIndex) {
    const ip = clientIp(request);
    if (ip) {
      const res = checkRateLimit(`mw-ip:${ip}`, IP_LIMIT, WINDOW_MS);
      if (!res.ok) {
        return new Response("Too many requests", {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(res.retryAfterMs / 1000)),
            "Content-Type": "text/plain",
            [NOINDEX_HEADER]: NOINDEX_VALUE,
          },
        });
      }
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the session so the cookie is refreshed when near expiry.
  await supabase.auth.getUser();

  // No crawler may index the anonymous parent surface (lib/no-index). Set LAST,
  // because `response` is replaced whenever the auth cookie is refreshed above —
  // and set here rather than per-route because the subtree serves PDFs and
  // calendar feeds from route handlers, which have no <head> to carry the meta
  // tag the /t/ layout emits.
  if (noIndex) response.headers.set(NOINDEX_HEADER, NOINDEX_VALUE);

  return response;
}

export const config = {
  // Run on all paths except static assets and image optimization. Token routes
  // and API routes handle their own auth, but refreshing the cookie there is
  // harmless and keeps the session alive across the whole app.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
