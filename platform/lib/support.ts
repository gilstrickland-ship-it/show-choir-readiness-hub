import * as Sentry from "@sentry/nextjs";

// Support access (§10, T030). Octv staff (profiles.is_support) get a READ-ONLY
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

// Log a support view. There is no support_views table (keeping the schema
// minimal and honest, T030) — every support session lands as a Sentry breadcrumb
// plus a server-log line, which is enough to diagnose "who looked at what, when".
// Sentry is a no-op when no DSN is configured, so this is safe in dev/pilot.
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
