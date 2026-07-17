// ============================================================================
// Octv Platform — RLS test harness (T004)
// ----------------------------------------------------------------------------
// Provisions a throwaway Postgres for the RLS suite, applies the foundation +
// RLS migrations against Supabase-shaped stubs, and hands the specs a set of
// role-scoped clients that exercise the policies exactly the way the app will.
//
// Provisioning strategy (first that works wins):
//   1. env DATABASE_URL set          → use it as-is (CI uses the postgres:16
//                                       service container this way).
//   2. initdb / pg_ctl available     → spin up a scratch cluster in a temp dir
//                                       (proven to work in this container).
//   3. docker + supabase CLI         → `supabase db start` fallback.
//   4. none of the above             → SKIP the whole suite with a LOUD banner
//                                       (process still exits 0).
//
// Because the migrations target Supabase, we first create the pieces the
// migrations assume exist on a real Supabase project: an `auth` schema with
// `auth.users` + `auth.uid()` reading a per-connection GUC, and the
// anon / authenticated / service_role roles. The storage bucket block in
// 0002_rls.sql is already guarded to no-op when the `storage` schema is absent.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, '..', '..', 'supabase', 'migrations');

// GUC the auth.uid() stub reads. Mirrors Supabase's `request.jwt.claim.sub`.
export const JWT_SUB_GUC = 'request.jwt.claim.sub';

const PG_ROLES = ['authenticated', 'anon', 'service_role'] as const;
type PgRole = (typeof PG_ROLES)[number];

// ----------------------------------------------------------------------------
// Skip signalling
// ----------------------------------------------------------------------------

export const SKIP_ENV = 'RLS_TEST_SKIP';
export const URL_ENV = 'RLS_TEST_DATABASE_URL';

export function rlsSkipped(): boolean {
  return process.env[SKIP_ENV] === '1';
}

export function printSkipBanner(reason: string): void {
  const line = '='.repeat(72);
  // Deliberately unmissable — an RLS suite that silently no-ops is worse than
  // one that fails, because tenant isolation is the existential bug (Const. I).
  console.warn(`\n${line}`);
  console.warn('  RLS TESTS SKIPPED — NO POSTGRES AVAILABLE');
  console.warn(`  reason: ${reason}`);
  console.warn('  Provide DATABASE_URL, or install postgresql-16 (initdb/pg_ctl),');
  console.warn('  or Docker + the supabase CLI, to run the tenant-isolation suite.');
  console.warn(`${line}\n`);
}

// ----------------------------------------------------------------------------
// Postgres binary discovery
// ----------------------------------------------------------------------------

function findPgBinDir(): string | null {
  // Honour an explicit override first.
  if (process.env.PG_BIN_DIR && existsSync(join(process.env.PG_BIN_DIR, 'initdb'))) {
    return process.env.PG_BIN_DIR;
  }
  // Debian/Ubuntu keep server binaries out of PATH under /usr/lib/postgresql/<v>/bin.
  const candidates = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin'];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) return dir;
  }
  // Fall back to PATH (macOS/Homebrew, Alpine, etc.).
  try {
    const initdb = execFileSync('bash', ['-lc', 'command -v initdb'], { encoding: 'utf8' }).trim();
    const pgctl = execFileSync('bash', ['-lc', 'command -v pg_ctl'], { encoding: 'utf8' }).trim();
    if (initdb && pgctl) return dirname(initdb);
  } catch {
    /* not on PATH */
  }
  return null;
}

function hasDockerSupabase(): boolean {
  try {
    execFileSync('bash', ['-lc', 'command -v docker && command -v supabase'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('could not obtain a free port')));
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Scratch-cluster lifecycle
// ----------------------------------------------------------------------------

interface Cluster {
  url: string;
  stop: () => void;
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// Postgres refuses to run as root, so when we are root we shell every server
// command through the `postgres` OS user (present on the postgresql-16 image).
function pgExec(binDir: string, cmd: string): void {
  if (isRoot) {
    execFileSync('su', ['postgres', '-c', `${binDir}/${cmd}`], { stdio: 'pipe' });
  } else {
    execFileSync('bash', ['-lc', `${binDir}/${cmd}`], { stdio: 'pipe' });
  }
}

async function provisionCluster(binDir: string): Promise<Cluster> {
  // Short base dir: the unix socket path has a 107-byte ceiling, and the deep
  // per-session scratchpad path blows past it.
  const dir = mkdtempSync(join(tmpdir(), 'octvpg-'));
  const dataDir = join(dir, 'data');
  if (isRoot) execFileSync('chown', ['-R', 'postgres:postgres', dir]);

  const port = await getFreePort();

  pgExec(binDir, `initdb -D ${dataDir} -A trust -U postgres --no-sync`);
  pgExec(
    binDir,
    `pg_ctl -D ${dataDir} -o "-p ${port} -k ${dir} -c listen_addresses=127.0.0.1" -l ${join(dir, 'pg.log')} -w start`,
  );

  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  const stop = () => {
    try {
      pgExec(binDir, `pg_ctl -D ${dataDir} -m immediate -w stop`);
    } catch {
      /* best effort */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  return { url, stop };
}

// ----------------------------------------------------------------------------
// Supabase-shaped stubs + migrations + grants
// ----------------------------------------------------------------------------

const STUB_SQL = `
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- Reads the per-connection GUC set by asUser(); empty/unset => NULL (anon).
create or replace function auth.uid() returns uuid
  language sql stable
as $fn$
  select nullif(current_setting('${JWT_SUB_GUC}', true), '')::uuid
$fn$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$roles$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
`;

// Grant table privileges AFTER the schema exists so RLS — not a missing GRANT —
// is what the specs actually exercise. (A missing grant and an RLS denial both
// surface as SQLSTATE 42501, which would let a broken policy pass silently.)
const GRANTS_SQL = `
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;
grant execute on all functions in schema private to anon, authenticated, service_role;
`;

export async function applySchema(url: string): Promise<void> {
  const admin = new Pool({ connectionString: url, max: 1 });
  try {
    const c = await admin.connect();
    try {
      await c.query(STUB_SQL);
      await c.query(readFileSync(join(MIGRATIONS_DIR, '0001_foundation.sql'), 'utf8'));
      await c.query(readFileSync(join(MIGRATIONS_DIR, '0002_rls.sql'), 'utf8'));
      await c.query(GRANTS_SQL);
    } finally {
      c.release();
    }
  } finally {
    await admin.end();
  }
}

// ----------------------------------------------------------------------------
// Public provisioning entry point (used by globalSetup)
// ----------------------------------------------------------------------------

export interface Provisioned {
  skipped: boolean;
  reason?: string;
  url?: string;
  mode?: 'database_url' | 'scratch_cluster' | 'docker_supabase';
  teardown: () => Promise<void> | void;
}

export async function provisionDatabase(): Promise<Provisioned> {
  // (0) explicit opt-out — lets CI/devs force the loud-skip path deliberately
  // (and is how the skip UX itself is exercised).
  if (process.env.RLS_FORCE_SKIP === '1') {
    return { skipped: true, reason: 'RLS_FORCE_SKIP=1 (skip forced)', teardown: () => {} };
  }

  // (1) explicit DATABASE_URL — CI service container / a dev's own Postgres.
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    await applySchema(envUrl);
    return { skipped: false, url: envUrl, mode: 'database_url', teardown: () => {} };
  }

  // (2) scratch cluster via initdb/pg_ctl.
  const binDir = findPgBinDir();
  if (binDir) {
    const cluster = await provisionCluster(binDir);
    try {
      await applySchema(cluster.url);
    } catch (err) {
      cluster.stop();
      throw err;
    }
    return {
      skipped: false,
      url: cluster.url,
      mode: 'scratch_cluster',
      teardown: () => cluster.stop(),
    };
  }

  // (3) docker + supabase CLI. We only detect availability here; wiring a full
  // `supabase db start` is heavier than the two paths above and this container
  // proves the scratch-cluster path, so we surface a clear message rather than
  // half-implement it.
  if (hasDockerSupabase()) {
    return {
      skipped: true,
      reason:
        'Docker + supabase CLI detected but the harness only auto-provisions via ' +
        'DATABASE_URL or a local initdb cluster. Run `supabase db start` and export ' +
        'DATABASE_URL to run the suite against it.',
      teardown: () => {},
    };
  }

  // (4) nothing available.
  return {
    skipped: true,
    reason: 'no DATABASE_URL, no initdb/pg_ctl, no Docker+supabase CLI',
    teardown: () => {},
  };
}

// ============================================================================
// Role-scoped clients for the specs
// ============================================================================

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env[URL_ENV];
    if (!url) throw new Error(`${URL_ENV} not set — provisioning did not run or was skipped`);
    pool = new Pool({ connectionString: url, max: 8 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface RlsError extends Error {
  code?: string;
}

/** A client bound to a role + (optionally) an authenticated user id. */
export class RlsClient {
  constructor(
    private readonly role: PgRole,
    private readonly sub: string | null,
  ) {}

  /**
   * Run `sql` inside a transaction with `SET LOCAL ROLE` + the auth GUC applied,
   * then ROLLBACK — so a spec can prove a write is *allowed* (no throw) without
   * ever mutating the shared seed, and prove a write is *denied* (throws).
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const client: PoolClient = await getPool().connect();
    try {
      await client.query('begin');
      // role is from a fixed allow-list — safe to interpolate.
      await client.query(`set local role ${this.role}`);
      await client.query(`select set_config('${JWT_SUB_GUC}', $1, true)`, [this.sub ?? '']);
      const res = await client.query<T>(sql, params);
      await client.query('rollback');
      return res;
    } catch (err) {
      try {
        await client.query('rollback');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Returns true if `sql` executes without error under this role. */
  async allows(sql: string, params: unknown[] = []): Promise<boolean> {
    try {
      await this.query(sql, params);
      return true;
    } catch {
      return false;
    }
  }

  /** Runs `sql`, expecting it to throw; returns the captured error. */
  async expectDenied(sql: string, params: unknown[] = []): Promise<RlsError> {
    try {
      await this.query(sql, params);
    } catch (err) {
      return err as RlsError;
    }
    throw new Error('expected the statement to be rejected, but it succeeded');
  }

  /** Convenience: number of rows returned by a SELECT. */
  async count(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.query(sql, params);
    return res.rowCount ?? 0;
  }
}

export function asUser(userId: string): RlsClient {
  return new RlsClient('authenticated', userId);
}

export function asAnon(): RlsClient {
  return new RlsClient('anon', null);
}

export function asService(): RlsClient {
  return new RlsClient('service_role', null);
}

/** Superuser query (RLS bypassed) — for seeding and reading ground-truth rows. */
export async function raw<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

/** SQLSTATE 42501 == RLS denial / insufficient privilege. */
export const RLS_DENIED = '42501';
