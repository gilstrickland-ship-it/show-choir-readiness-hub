// ============================================================================
// itinerary.spec.ts — a published schedule cannot lose a line in silence (T169)
// ----------------------------------------------------------------------------
// The living-itinerary banner ("Updated {when}", and the staff nudge beside it)
// used to be computed from `itinerary_items.updated_at` across the rows that are
// still there. That is blind to a DELETION by construction — the row is gone, so
// there is nothing left to read — and a director who removed a stop from a
// PUBLISHED schedule got no banner at all while families kept following it.
//
// Migration 0024 moves the fact to the parent: `itineraries.items_changed_at`,
// stamped by `trg_itinerary_items_changed` on INSERT, UPDATE **and DELETE**.
// This file is the proof, and it is deliberately written so that DELETING THE
// TRIGGER TURNS IT RED: every assertion below is about the stamp actually moving
// (or deliberately not moving), never about the trigger's existence in a catalog.
//
// Everything runs as A's director through the RLS client, so each case is also
// a real write under the real policies — and each is rolled back, so the shared
// seed is untouched. The trigger is SECURITY DEFINER on purpose: the stamp is an
// UPDATE of a *different* table, and an RLS-filtered UPDATE does not fail, it
// silently matches nothing.
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { A, B } from './fixtures';
import { asUser, asService, rlsSkipped, MIGRATIONS_DIR } from './harness';
import type { PoolClient } from 'pg';

const director = () => asUser(A.director);

// The migration itself, read from disk — the backfill case below re-runs it
// verbatim rather than restating what it is supposed to do.
const MIGRATION_0024 = readFileSync(
  join(MIGRATIONS_DIR, '0024_itinerary_items_changed_at.sql'),
  'utf8',
);

/**
 * The one case that needs DDL: proving the BACKFILL against rows that existed
 * before the column did means putting the schema back the way production's is
 * today, which only the owning role may do. It drops back to the session's own
 * role inside the same rolled-back transaction — nothing escapes it, and every
 * other test in this file runs under a real seat with RLS on.
 */
async function asOwner<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
  return asService().tx(async (c) => {
    await c.query('reset role');
    return run(c);
  });
}

// A time long before anything else in the fixture, so "the stamp moved" is
// unambiguous. now() is the TRANSACTION's start time in Postgres, so every
// statement inside one `tx` shares it — which is exactly why the baseline has to
// be a literal from another decade rather than a second measurement of now().
const LONG_AGO = '2020-01-01T00:00:00Z';

// Park A's itinerary in the state the banner is about: published back in 2020,
// with its items last changed at the same moment. Anything that stamps after
// this leaves items_changed_at > published_at, which is the banner's whole rule.
async function publishedLongAgo(c: PoolClient): Promise<void> {
  await c.query(
    `update itineraries
        set status = 'published', published_at = $2, items_changed_at = $2
      where id = $1`,
    [A.itinerary, LONG_AGO],
  );
}

// `changed` is the banner's exact rule. `moved` is whether the stamp left the
// baseline at all — asked as a comparison in SQL rather than by formatting the
// timestamp, because `::text` renders in the session's time zone and 2020-01-01Z
// comes back as 2019-12-31 in Chicago.
async function readStamp(
  c: PoolClient,
  itineraryId: string,
): Promise<{ changed: boolean | null; moved: boolean }> {
  const res = await c.query<{ changed: boolean | null; moved: boolean }>(
    `select items_changed_at > published_at as changed,
            items_changed_at <> $2::timestamptz as moved
       from itineraries where id = $1`,
    [itineraryId, LONG_AGO],
  );
  return res.rows[0];
}

describe.skipIf(rlsSkipped())('itineraries.items_changed_at', () => {
  test('the column exists, is NOT NULL, and defaults itself', async () => {
    // A new itinerary is "last changed" the moment it is created, so a schedule
    // that has never been touched can never read as changed since publishing.
    const row = await director().tx(async (c) => {
      const res = await c.query<{ items_changed_at: string | null }>(
        `insert into itineraries (program_id, competition_id, status)
         values ($1, $2, 'draft')
         returning items_changed_at`,
        [A.program, A.competition],
      );
      return res.rows[0];
    });
    expect(row.items_changed_at).not.toBeNull();
  });

  // ---- The defect, stated as a test ----------------------------------------

  test('DELETING an item from a published itinerary stamps the parent', async () => {
    const after = await director().tx(async (c) => {
      await publishedLongAgo(c);
      const del = await c.query(
        `delete from itinerary_items where id = $1 and program_id = $2`,
        [A.itineraryItem, A.program],
      );
      // The delete has to have actually happened, or the assertion below would
      // pass for the wrong reason on a day RLS changes.
      expect(del.rowCount).toBe(1);
      return readStamp(c, A.itinerary);
    });
    expect(after.changed).toBe(true);
    expect(after.moved).toBe(true);
  });

  test('the deletion leaves NO surviving row that could report it', async () => {
    // Why the parent timestamp had to exist at all: after the delete there is
    // nothing left whose updated_at the old rule could have read.
    const remaining = await director().tx(async (c) => {
      await c.query(`delete from itinerary_items where id = $1`, [A.itineraryItem]);
      const res = await c.query<{ n: string }>(
        `select count(*)::text as n, coalesce(max(updated_at)::text, 'none') as latest
           from itinerary_items where itinerary_id = $1`,
        [A.itinerary],
      );
      return res.rows[0];
    });
    expect(remaining.n).toBe('0');
  });

  // ---- The other two write shapes ------------------------------------------

  test('ADDING an item to a published itinerary stamps the parent', async () => {
    const after = await director().tx(async (c) => {
      await publishedLongAgo(c);
      await c.query(
        `insert into itinerary_items (itinerary_id, program_id, kind, title, sort_order)
         values ($1, $2, 'other', 'Extra stop', 9)`,
        [A.itinerary, A.program],
      );
      return readStamp(c, A.itinerary);
    });
    expect(after.changed).toBe(true);
  });

  test('EDITING an item on a published itinerary stamps the parent', async () => {
    const after = await director().tx(async (c) => {
      await publishedLongAgo(c);
      await c.query(`update itinerary_items set title = 'Take the stage (later)' where id = $1`, [
        A.itineraryItem,
      ]);
      return readStamp(c, A.itinerary);
    });
    expect(after.changed).toBe(true);
  });

  // ---- What must NOT move it -----------------------------------------------

  test('PUBLISHING does not stamp — publishing starts the clock, it is not a change', async () => {
    // The trigger is on itinerary_items, never on itineraries, so the publish
    // write cannot raise the banner it is the baseline for. If it could, every
    // itinerary would announce "Updated" the instant families first saw it.
    const after = await director().tx(async (c) => {
      await c.query(
        `update itineraries set status = 'draft', published_at = null, items_changed_at = $2
          where id = $1`,
        [A.itinerary, LONG_AGO],
      );
      await c.query(
        `update itineraries set status = 'published', published_at = now() where id = $1`,
        [A.itinerary],
      );
      return readStamp(c, A.itinerary);
    });
    expect(after.moved).toBe(false);
    expect(after.changed).toBe(false);
  });

  test('UNPUBLISHING does not stamp either', async () => {
    const after = await director().tx(async (c) => {
      await publishedLongAgo(c);
      await c.query(
        `update itineraries set status = 'draft', published_at = null where id = $1`,
        [A.itinerary],
      );
      return readStamp(c, A.itinerary);
    });
    expect(after.moved).toBe(false);
  });

  test("one program's item change never stamps another program's itinerary", async () => {
    // The stamp is keyed on the item's own itinerary_id (Constitution I), so B's
    // schedule is untouched by anything A does to hers. Run as service_role
    // because reading B's ground truth is the point — a filtered read would make
    // this pass for the wrong reason.
    const b = await asService().tx(async (c) => {
      await c.query(`update itineraries set items_changed_at = $2 where id = $1`, [
        B.itinerary,
        LONG_AGO,
      ]);
      const del = await c.query(`delete from itinerary_items where id = $1`, [A.itineraryItem]);
      expect(del.rowCount).toBe(1);
      return readStamp(c, B.itinerary);
    });
    expect(b.moved).toBe(false);
  });
});

// ============================================================================
// The backfill (migration 0024 §1)
// ----------------------------------------------------------------------------
// The day this applies, every itinerary in production already exists — and the
// value it is given decides whether families open their link to a banner that
// is simply not true. So the column is put back the way production's schema is
// today (nullable, unset), the fixture is arranged into the states that matter,
// and THE MIGRATION FILE ITSELF is re-run over them. All inside one transaction
// that is rolled back.
// ============================================================================

describe.skipIf(rlsSkipped())('0024 backfill', () => {
  test('an itinerary published AFTER its last item edit does not claim it changed', async () => {
    const row = await asOwner(async (c) => {
      await c.query(`alter table itineraries alter column items_changed_at drop not null`);
      // Published an hour after the schedule was last touched: the ordinary case,
      // and the one that must stay silent.
      await c.query(
        `update itineraries
            set status = 'published', published_at = now() + interval '1 hour',
                items_changed_at = null
          where id = $1`,
        [A.itinerary],
      );

      await c.query(MIGRATION_0024);

      const res = await c.query<{ changed: boolean; from_items: boolean }>(
        `select i.items_changed_at > i.published_at as changed,
                i.items_changed_at = (
                  select max(x.updated_at) from itinerary_items x where x.itinerary_id = i.id
                ) as from_items
           from itineraries i where i.id = $1`,
        [A.itinerary],
      );
      return res.rows[0];
    });
    expect(row.changed).toBe(false);
    // "the greatest of the itinerary's items' updated_at" — stated as a check,
    // not as a comment.
    expect(row.from_items).toBe(true);
  });

  test('an itinerary edited AFTER publishing keeps the banner it already had', async () => {
    // The other half of the same promise: the backfill computes exactly what the
    // old per-item rule computed, so nothing that was showing a banner loses it.
    const row = await asOwner(async (c) => {
      await c.query(`alter table itineraries alter column items_changed_at drop not null`);
      await c.query(
        `update itineraries
            set status = 'published', published_at = now() - interval '1 hour',
                items_changed_at = null
          where id = $1`,
        [A.itinerary],
      );

      await c.query(MIGRATION_0024);

      const res = await c.query<{ changed: boolean }>(
        `select items_changed_at > published_at as changed from itineraries where id = $1`,
        [A.itinerary],
      );
      return res.rows[0];
    });
    expect(row.changed).toBe(true);
  });

  test('an itinerary with NO items falls back to its own timestamp', async () => {
    const row = await asOwner(async (c) => {
      await c.query(`alter table itineraries alter column items_changed_at drop not null`);
      const made = await c.query<{ id: string }>(
        `insert into itineraries (program_id, competition_id, status, published_at)
         values ($1, $2, 'published', now() + interval '1 hour')
         returning id`,
        [A.program, A.competitionArchived],
      );
      const id = made.rows[0].id;
      await c.query(`update itineraries set items_changed_at = null where id = $1`, [id]);

      await c.query(MIGRATION_0024);

      const res = await c.query<{ changed: boolean; own: boolean }>(
        `select items_changed_at > published_at as changed,
                items_changed_at = updated_at   as own
           from itineraries where id = $1`,
        [id],
      );
      return res.rows[0];
    });
    expect(row.changed).toBe(false);
    expect(row.own).toBe(true);
  });

  test('re-running the migration leaves the backfilled values alone', async () => {
    // Idempotence where it actually costs something: a second apply must not
    // re-stamp rows that already have an answer.
    const row = await asOwner(async (c) => {
      const before = await c.query<{ stamp: string }>(
        `select items_changed_at::text as stamp from itineraries where id = $1`,
        [A.itinerary],
      );
      await c.query(MIGRATION_0024);
      const after = await c.query<{ stamp: string }>(
        `select items_changed_at::text as stamp from itineraries where id = $1`,
        [A.itinerary],
      );
      return { before: before.rows[0].stamp, after: after.rows[0].stamp };
    });
    expect(row.after).toBe(row.before);
  });
});
