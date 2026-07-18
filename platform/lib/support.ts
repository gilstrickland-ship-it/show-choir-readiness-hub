import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";

// Support access (§10, T030). Support staff (profiles.is_support) get a READ-ONLY
// view of a program while the director's consent window is open
// (programs.support_access_until in the future). The RLS policies in
// 0004_support_access.sql are the real boundary; these are the app-side helpers.

// How long a director's "grant support access" click lasts.
export const SUPPORT_ACCESS_DAYS = 7;

// True when `until` is a real timestamp still in the future.
export function supportAccessActive(
  until: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!until) return false;
  const t = new Date(until);
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() > now.getTime();
}

// The ISO instant SUPPORT_ACCESS_DAYS from now — what a "grant" writes.
export function supportAccessUntilFromNow(now: Date = new Date()): string {
  return new Date(now.getTime() + SUPPORT_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Log a support view. Two trails, both best-effort:
//   • a Sentry breadcrumb + server-log line for live debugging (kept from T030 —
//     visible even without a DB round-trip or Sentry DSN);
//   • a durable support_access_log row (T035) so the CONSENTING program can see
//     for itself who from support looked, and when. That row is written via the
//     service-role client because RLS grants no client INSERT on the audit table
//     (tamper-evidence): not even a support user with consent can forge an entry.
export function logSupportView(args: {
  programSlug: string;
  programId: string;
  userId: string;
}): void {
  Sentry.addBreadcrumb({
    category: "support",
    level: "info",
    message: `support view: ${args.programSlug}`,
    data: { programId: args.programId, userId: args.userId },
  });
  // Structured server log so the view is visible even without Sentry.
  console.info(
    `[support-view] user=${args.userId} program=${args.programSlug} (${args.programId})`,
  );
}

// Durable audit insert (T035). Awaited by getTenantContext for support views, so
// the row lands before the render completes. Never throws — a failed audit
// insert (or a missing service-role key in dev/pilot) must not deny support the
// view; the breadcrumb above is the fallback trail.
export async function recordSupportView(args: {
  programSlug: string;
  programId: string;
  userId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("support_access_log").insert({
      program_id: args.programId,
      support_user_id: args.userId,
      path: `/${args.programSlug}`,
    });
  } catch {
    // Best-effort — never a denial-of-service vector for a support view.
  }
}

// Recent support views for a program's transparency panel (Settings, §10). Uses
// the caller's RLS client — the support_access_log_read policy (0005) already
// scopes this to the program's own director/admin/board. Newest first.
export interface SupportView {
  support_user_id: string;
  path: string | null;
  at: string;
}
export async function recentSupportViews(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  programId: string,
  limit = 20,
): Promise<SupportView[]> {
  const { data } = await supabase
    .from("support_access_log")
    .select("support_user_id, path, at")
    .eq("program_id", programId)
    .order("at", { ascending: false })
    .limit(limit);
  return (data as SupportView[] | null) ?? [];
}
