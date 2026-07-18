# Season OS for Competitive Show Choir

The operational backbone for a school's competitive show choir program — director + booster side. Tracks money, never moves it. AI strictly backstage. Parents never need accounts.

> The product is currently under the working codename "Octv"; all branding is env-driven via `lib/brand.ts` (renaming is a one-file change plus DNS).

## What's in this repo

| Path | Contents |
|---|---|
| `app/`, `lib/`, `supabase/`, `tests/` | The application: Next.js App Router + Supabase (Postgres/Auth/Storage with per-program RLS), Inngest jobs, Resend email, React-PDF documents, Claude API (packet parse + digest drafts, always draft-only) |
| `specs/001-octv-platform/` | Spec Kit artifacts: architecture spec (authoritative), feature spec, plan, data model, and the 41-task build log |
| `.specify/memory/constitution.md` | The project constitution — ten governing principles, three non-negotiable |
| `docs/research/` | Original problem discovery, evidence matrix, MVP spec, and UX research that preceded the platform |
| `.github/workflows/platform-ci.yml` | CI: typecheck, build, and the RLS test suite against Postgres 16 on every platform change |

An earlier front-end prototype (Vite/React) lived at the repo root; it was retired in favor of this platform and remains available in git history.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + keys
# Apply supabase/migrations/*.sql to your Supabase project (supabase db push
# or the SQL editor), optionally load supabase/seed.sql for demo data
npm run dev
```

Optional integrations (everything degrades gracefully without them):

- `ANTHROPIC_API_KEY` — host-packet parsing and weekly digest drafts
- `RESEND_API_KEY` — announcement/digest email delivery + bounce webhooks
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — background jobs (inline fallbacks run without them)
- `SENTRY_DSN` — error reporting (no-op when absent)

## Tests

```bash
npm run typecheck
npm run test:unit   # pure-function suites (import parsing, money, tz, tokens, flags…)
npm run test:rls    # 169 tests: tenant isolation on every table, role gates,
                    # archived-season freeze, ledger void-only, token surfaces —
                    # provisions a throwaway Postgres (or uses DATABASE_URL)
npm run build
```

The RLS suite is CI-blocking: a cross-program data leak is the existential bug for this product, so isolation tests enumerate every `program_id` table at runtime — new tables can't dodge coverage.

## Deployment

- **Vercel**: import the repo as-is — the app lives at the repo root, so no Root Directory override is needed.
- **Supabase**: apply migrations in order (`0001`–`0005`); storage buckets and RLS policies are created by the migrations.
- **Email**: verify the sending domain in Resend and point the bounce + inbound webhooks at `/api/webhooks/resend` and `/api/webhooks/resend-inbound`.

## Development workflow

This repo uses Spec Kit (spec-driven development): constitution → spec → plan → tasks → implement → converge. Planning artifacts live in `specs/`; every implementation task traces to a task ID in `specs/001-octv-platform/tasks.md`. See `AGENTS.md` for AI-tool handoff notes.
