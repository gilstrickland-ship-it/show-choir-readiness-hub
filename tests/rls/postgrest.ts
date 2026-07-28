// ============================================================================
// A PostgREST-shaped client over a real Postgres connection
// ----------------------------------------------------------------------------
// The RLS suite speaks SQL; the app speaks supabase-js. Anything the app loads
// through a query BUILDER — lib/pdf/queries.ts above all — can therefore only be
// tested one of two ways: restate its query in SQL and assert the restatement
// (which proves nothing about the loader, because the loader never runs), or
// give the loader something that behaves like the client it expects. This is the
// second.
//
// It is deliberately small and deliberately strict: it supports exactly the
// builder verbs lib/pdf/queries.ts uses, and THROWS on anything else rather than
// silently ignoring a filter. A stub that quietly drops an `.eq("program_id", …)`
// would turn a tenancy test green while the tenancy check was gone, which is the
// failure mode this whole file exists to avoid.
//
// It runs every statement on the PoolClient it is handed, so it inherits that
// connection's `SET LOCAL ROLE` and auth GUC — RLS applies to it exactly as it
// applies to the app — and it participates in the caller's rolled-back
// transaction, so seeded rows never escape into another spec.
//
// `.range(from, to)` maps to LIMIT/OFFSET, which is what makes the paging loop
// in fetchAllRows a real loop against real rows: a 1,200-row season comes back
// as two round trips, and a loader that stopped after the first would be short
// 200 entries here just as it was in production.
// ============================================================================

import type { PoolClient } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'isNull'; col: string }
  | { kind: 'in'; col: string; vals: unknown[] };

interface Order {
  col: string;
  ascending: boolean;
}

interface Result {
  data: unknown;
  error: { message: string } | null;
}

class Query {
  private cols = '*';
  private readonly filters: Filter[] = [];
  private readonly orders: Order[] = [];

  constructor(
    private readonly client: PoolClient,
    private readonly table: string,
  ) {}

  select(cols: string): this {
    this.cols = cols;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }

  is(col: string, val: unknown): this {
    if (val !== null) {
      throw new Error(`postgrest stub: .is(${col}, ${String(val)}) — only IS NULL is supported`);
    }
    this.filters.push({ kind: 'isNull', col });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push({ kind: 'in', col, vals });
    return this;
  }

  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ col, ascending: opts.ascending !== false });
    return this;
  }

  private sql(limit: number | null, offset: number): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const where: string[] = [];
    for (const f of this.filters) {
      if (f.kind === 'isNull') {
        where.push(`${f.col} is null`);
      } else if (f.kind === 'eq') {
        params.push(f.val);
        where.push(`${f.col} = $${params.length}`);
      } else {
        params.push(f.vals);
        where.push(`${f.col} = any($${params.length})`);
      }
    }
    const orderBy = this.orders
      .map((o) => `${o.col} ${o.ascending ? 'asc' : 'desc'}`)
      .join(', ');
    const text = [
      `select ${this.cols} from ${this.table}`,
      where.length > 0 ? `where ${where.join(' and ')}` : '',
      orderBy ? `order by ${orderBy}` : '',
      limit === null ? '' : `limit ${limit} offset ${offset}`,
    ]
      .filter(Boolean)
      .join(' ');
    return { text, params };
  }

  private async run(limit: number | null, offset: number): Promise<Result> {
    const { text, params } = this.sql(limit, offset);
    try {
      const res = await this.client.query(text, params);
      return { data: res.rows, error: null };
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } };
    }
  }

  // PostgREST's inclusive bounds. fetchAllRows drives this and stops when a page
  // comes back short, so LIMIT has to be exactly the width it asked for.
  async range(from: number, to: number): Promise<Result> {
    return this.run(to - from + 1, from);
  }

  async maybeSingle(): Promise<Result> {
    const res = await this.run(2, 0);
    if (res.error) return res;
    const rows = res.data as unknown[];
    return { data: rows[0] ?? null, error: null };
  }

  // A plain `await` on the builder — the un-ranged read.
  then<T>(resolve: (v: Result) => T): Promise<T> {
    return this.run(null, 0).then(resolve);
  }
}

// The `as unknown as SupabaseClient` is the same cast every caller in the app
// makes at the boundary; what is guaranteed here is the verb set above, and
// anything outside it throws loudly rather than passing.
export function postgrestOver(client: PoolClient): SupabaseClient {
  return {
    from(table: string) {
      return new Query(client, table);
    },
  } as unknown as SupabaseClient;
}
