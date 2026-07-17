// ============================================================================
// Octv Platform — RLS globalSetup (T004)
// ----------------------------------------------------------------------------
// Provisions Postgres once (DATABASE_URL → scratch cluster → LOUD skip),
// applies the foundation + RLS migrations against Supabase-shaped stubs, and
// seeds the two-program fixture. The resolved connection string is handed to
// the worker via process.env (inherited across the forks pool). On no-Postgres
// it sets the skip flag so every spec self-skips and the run still exits 0.
// ============================================================================

import { provisionDatabase, printSkipBanner, SKIP_ENV, URL_ENV, type Provisioned } from './harness';
import { seedDatabase } from './seed';

let provisioned: Provisioned | undefined;

export async function setup(): Promise<void> {
  provisioned = await provisionDatabase();

  if (provisioned.skipped) {
    printSkipBanner(provisioned.reason ?? 'unknown');
    process.env[SKIP_ENV] = '1';
    return;
  }

  process.env[SKIP_ENV] = '0';
  process.env[URL_ENV] = provisioned.url!;
  await seedDatabase(provisioned.url!);
  // eslint-disable-next-line no-console
  console.log(`\n[rls] Postgres provisioned via "${provisioned.mode}" — suite armed.\n`);
}

export async function teardown(): Promise<void> {
  await provisioned?.teardown();
}
