import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation hook (§10). Loads the runtime-specific Sentry config
// once per server/edge process, and forwards nested React Server Component
// render errors to Sentry via onRequestError. All no-ops without a DSN.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
