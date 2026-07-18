// Per-file setup: close the lazily-created pool after each spec file so the
// worker exits cleanly (all files share one fork; the pool re-opens on demand).
import { afterAll } from 'vitest';
import { closePool } from './harness';

afterAll(async () => {
  await closePool();
});
