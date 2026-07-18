import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// SSR server client (@supabase/ssr). RLS is the real gate — this client carries
// the signed-in user's JWT so every query runs as that user (Constitution I).
// Used by server components and server actions. Cookie writes are attempted but
// swallowed when called from a Server Component (read-only cookie store there):
// middleware.ts is what actually refreshes the session cookie on each request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — the cookie store is read-only.
            // Session refresh is handled in middleware, so this is safe to drop.
          }
        },
      },
    },
  );
}
