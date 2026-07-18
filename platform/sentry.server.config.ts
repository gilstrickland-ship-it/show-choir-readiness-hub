import * as Sentry from "@sentry/nextjs";

// Sentry server init (§10). DSN is env-driven; when SENTRY_DSN is absent the SDK
// initializes as a no-op (no network, no overhead), so dev/pilot and the build
// run cleanly without any Sentry account. Kept intentionally lean.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  enabled: Boolean(process.env.SENTRY_DSN),
});
