import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Session refresh per the @supabase/ssr middleware pattern. Runs on every
// matched request: rehydrates the Supabase auth cookie so server components and
// actions always see a fresh session. Does NOT gate routes itself — page-level
// getTenantContext()/requireRole() own authorization (Constitution I, defense in
// depth). Keep this lean: any logic between createServerClient and getUser risks
// hard-to-debug logout bugs.
export async function middleware(request: NextRequest) {
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
