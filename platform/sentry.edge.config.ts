import * as Sentry from "@sentry/nextjs";

// Sentry edge init (§10). Same no-op-without-DSN posture as the server config.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  enabled: Boolean(process.env.SENTRY_DSN),
});
