import { defineConfig, devices } from "@playwright/test";

// ============================================================================
// Octv Platform — end-to-end USER JOURNEY suite (Playwright).
// ----------------------------------------------------------------------------
// Named .e2e so it never collides with the two vitest configs (vitest.config.ts
// = RLS, vitest.unit.config.ts = pure units). Vitest scopes its `include` to
// tests/rls and tests/unit, so tests/e2e is invisible to it; this config owns
// tests/e2e exclusively.
//
// The suite drives the built app against a REAL local Supabase stack
// (`supabase start`) — it cannot run in a sandbox that can't reach the Docker
// images / auth stack, so it runs in GitHub Actions (see .github/workflows).
// global-setup provisions the auth users + a guardian token the specs rely on.
//
// Single worker + retries(1) in CI: the specs share one seeded tenant (Demo
// Show Choir) and mutate it (attendance toggles, shift claims, absence
// requests), so parallel files would race the same rows. Serial keeps the
// journeys deterministic; each spec is still independently runnable.
// ============================================================================

const PORT = 3000;
const baseURL = process.env.APP_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",

  // One worker — the specs share and mutate a single seeded program.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,

  // Generous but bounded — server actions do a Postgres round-trip per submit.
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL,
    trace: "retain-on-failure",
    // Follow server-action redirects and load real assets.
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // The CI job builds first (`npm run build`), then this starts the production
  // server. reuseExistingServer lets a locally-running `npm run start` be reused.
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
