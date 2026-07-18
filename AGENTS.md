# Agent / AI-Tool Handoff

This repo contains the Season OS platform for competitive show choir programs (working codename "Octv" — brand is env-driven, never hardcoded).

## Read these first, in order

1. `.specify/memory/constitution.md` — ten governing principles. I, III, and IV are NON-NEGOTIABLE: per-program tenant isolation (RLS + tests), directory-tier PII only (no health/medical/emergency/DOB/address/photo data, ever), and AI as draft-producer only (nothing AI-generated reaches a parent without staff approval).
2. `specs/001-octv-platform/architecture-spec.md` — the authoritative product/architecture spec.
3. `specs/001-octv-platform/tasks.md` — the 41-task build log (all complete); `plan.md` and `data-model.md` explain structure and schema conventions.

## The codebase (repo root)

- Next.js App Router at the repo root, TypeScript strict, server components + server actions throughout, **no client state library**; `'use client'` only where a form genuinely needs interactivity.
- Supabase: schema + RLS live in `supabase/migrations/0001`–`0006`. Every migration pairs schema with policies. The RLS harness (`tests/rls/harness.ts`) applies all migrations in lexical order — new migrations are exercised automatically, and the isolation suite enumerates every `program_id` table at runtime.
- Roles: director, admin, treasurer, costume_manager, board_member (matrix in arch spec §2). RLS enforces coarsely; every server action re-checks via `lib/auth.ts` `requireRole` (defense in depth).
- Parents/students have no accounts. The parents' entire surface is `(public)/t/[token]` driven by `lib/tokens.ts` — an explicit capability allow-list over hashed-at-rest tokens. Keep that allow-list tiny.
- Feature exposure is flag-gated server-side (`lib/flags.ts`: override ?? tier bundle ?? default). Routes 404 via `requireFlag`; Inngest jobs check the same helper.
- Branding flows only from `lib/brand.ts` + env (Constitution IX). A codename grep over `app/ lib/ emails/` must hit only `brand.ts`.
- Money is integer cents; ledger rows void, never delete/update (DB trigger enforces).
- All times timestamptz UTC, rendered in `programs.timezone` via `lib/datetime.ts`.

## Working rules

- Verification gate for any change: `npm run typecheck && npm run build && npm run test:unit && npm run test:rls` (in `platform/`). The RLS suite provisions a throwaway Postgres; CI runs it against a postgres:16 service.
- Follow the Spec Kit lifecycle for new work: update `specs/` first (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`), implement against task IDs, then `/speckit-converge` to audit.
- Free-text fields that reach staff or parents carry the "Do not enter health or medical information." label — keep it on new surfaces.

## History

The original Vite/React prototype and its research docs preceded this platform. The prototype was removed from the working tree (recoverable in git history); the research lives in `docs/research/`.
