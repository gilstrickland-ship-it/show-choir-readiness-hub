import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Octv Platform — Vitest config for PURE unit tests (tests/unit)
// ----------------------------------------------------------------------------
// Deliberately separate from vitest.config.ts (the RLS suite): it has NO
// globalSetup, so running `test:unit` never provisions a Postgres cluster or
// touches the DB. These specs cover pure functions only (e.g. the CSV import
// parser) and run in milliseconds.
// ============================================================================

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → project root, so specs import app modules the
    // same way the app does.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
  },
});
