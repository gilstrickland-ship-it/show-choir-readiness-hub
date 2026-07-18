import * as Sentry from "@sentry/nextjs";

// Sentry client init (§10). Next.js auto-loads this file in the browser.
// NEXT_PUBLIC_SENTRY_DSN is env-driven; absent → the SDK is a no-op so no beacon
// is ever sent and nothing is bundled beyond the (tree-shaken) SDK shell.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
