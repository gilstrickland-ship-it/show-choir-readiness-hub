import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Octv Platform — Vitest config (T004, RLS suite)
// ----------------------------------------------------------------------------
// The RLS specs share ONE Postgres cluster provisioned in globalSetup, so they
// must not run in parallel across processes (they'd race the same seed rows and
// exhaust connections). A single fork with sequential files + a node env is the
// contract; timeouts are generous because provisioning may initdb a cluster and
// apply two migrations on a cold container.
// ============================================================================

export default defineConfig({
  resolve: {
    // Same "@/*" → project root alias the unit config has. One spec here reads a
    // SQL aggregate and the app helper that has to agree with it, and compares
    // them over the same rows; it imports that helper the way the app does.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globalSetup: ['./tests/rls/global-setup.ts'],
    setupFiles: ['./tests/rls/setup.ts'],
    include: ['tests/rls/**/*.spec.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
