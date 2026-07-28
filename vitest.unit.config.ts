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
  // The .tsx spec below compiles JSX the way Next does — the automatic runtime,
  // so a spec never has to import React just to render one component.
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirror tsconfig's "@/*" → project root, so specs import app modules the
    // same way the app does.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // .tsx too: one spec renders a server component to static markup to prove a
    // destructive control is absent from the page until it is confirmed
    // (T143e) — which is a fact about JSX, not about a pure function.
    include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.tsx'],
  },
});
