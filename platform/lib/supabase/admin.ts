import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — SERVER ONLY. Bypasses RLS entirely, so it must never be
// imported into a client component or used to serve unfiltered tenant data. It
// exists for the two places RLS cannot cover: (1) reading an `invited`
// program_members row before the invitee is a member, and (2) the anonymous
// token surface (§8a) built in later tasks. The service-role key is a non-
// NEXT_PUBLIC_ env var, so Next never bundles it into client code.
//
// Every caller is responsible for its own tenant + capability checks; the
// service-role client provides none.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
