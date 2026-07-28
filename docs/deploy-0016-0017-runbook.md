# Deploy runbook — migrations 0016 + 0017 (production)

**APPLIED 2026-07-27.** Production `season-engine` (`eaewbydelcgyskbhejnk`) was at **0015**; `0016`, `0017` and follow-up `0018` are now applied and verified (61/61 edges composite, 0 poisoned rows, 3/3 competitions backfilled, security advisors clear). This document is kept as the record and as the procedure for any other environment.

Original status follows.

| # | Migration | Why it is pending | Impact today |
|---|---|---|---|
| 0016 | `0016_multi_ensemble.sql` | Merged to `main` with feature 004; its "apply in production" task (T114) was never completed | **Live defect.** Deployed code queries `competition_ensembles` / `event_ensembles`, which don't exist. Reads fail silently (the error is swallowed), so every competition shows **no ensembles**; creating a competition inserts the row, then fails at the junction insert and shows a generic save error. |
| 0017 | `0017_cross_program_refs.sql` | New (spec 005 Wave S) | **Security.** Closes a cross-tenant reference hole: rows owned by one program could reference another program's records — invisible and undeletable to the victim, able to block their inserts and deletes, and able to render attacker-controlled text into their parent-facing PDFs. |

Both are safe to apply: `0017` fails loudly rather than deleting anything if it finds pre-existing cross-program rows, and both are re-runnable (a retried push is a no-op).

## Pre-flight — already done

Run against production on 2026-07-27, read-only: **0 cross-program rows** across all 15 key relationships. `0017` will apply cleanly with no data decisions required.

To re-check at any time (read-only, safe):

```sql
select * from private.cross_program_refs();
```

(That function ships *in* 0017, so before 0017 is applied use the ad-hoc join query in the audit; after it, this is the standing check.)

## Apply

### Option A — Supabase CLI (preferred)

The CLI is **not installed** on this machine and the repo is **not linked** to the remote project. From the repo root:

```bash
npx --yes supabase@latest login
```

```bash
npx --yes supabase@latest link --project-ref eaewbydelcgyskbhejnk
```

```bash
npx --yes supabase@latest db push
```

`db push` applies every migration the remote is missing, in lexical order — so it runs `0016` then `0017` for you. Expect it to report exactly those two.

### Option B — Dashboard SQL editor (no CLI)

In the Supabase dashboard → SQL Editor, run the contents of these two files, **in this order**, each as its own execution:

1. `supabase/migrations/0016_multi_ensemble.sql`
2. `supabase/migrations/0017_cross_program_refs.sql`

Then record them so future pushes don't retry (the CLI tracks applied migrations in `supabase_migrations.schema_migrations`):

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260722000000', '0016_multi_ensemble'), ('20260727000000', '0017_cross_program_refs')
on conflict (version) do nothing;
```

## Verify after applying

```sql
select
  (select count(*) from competition_ensembles) as comp_ensemble_rows,
  (select count(*) from information_schema.columns
     where table_name='competitions' and column_name='ensemble_id') as old_column_gone_if_zero,
  (select count(*) from pg_constraint
     where contype='f' and array_length(conkey,1)=2) as composite_fks;
```

Expected: `comp_ensemble_rows` = 3 (the three existing competitions, backfilled from their old `ensemble_id`), `old_column_gone_if_zero` = 0, `composite_fks` ≥ 61.

Then in the app: open a competition and confirm its ensemble chips render (they are blank today).

## Rollback posture

- `0016` drops `competitions.ensemble_id` / `events.ensemble_id` after backfilling the junction tables. Rolling back means restoring from a point-in-time backup — but the deployed code already requires the post-0016 shape, so rolling back re-breaks the app. Forward is the only sensible direction.
- `0017` only adds constraints and replaces two functions; it can be reversed by dropping the `*_program_fkey` constraints and the `trg_share_links_resource_program` trigger, at the cost of reopening the vulnerability.
