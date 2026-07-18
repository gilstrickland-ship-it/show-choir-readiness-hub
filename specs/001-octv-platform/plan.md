# Implementation Plan: Octv Platform

**Branch**: `claude/fable-opus-speckit-workflow-lutsrp` | **Date**: 2026-07-17 | **Spec**: `specs/001-octv-platform/spec.md`

**Workflow (AiDLC)**: Spec Kit structure · **Fable** authors and maintains all planning artifacts and reviews outputs · **Opus 4.8** executes implementation tasks as coding agents, one dependency-ordered phase at a time.

## Summary

Build the complete Octv platform in `platform/` (new Next.js app), leaving the existing Vite prototype at the repo root untouched as reference. The data model ships fully wired in the first migration set; features are exposed per program via flags. Build order follows architecture-spec §11 (foundation → roster → domains → comms → lifecycle).

## Technical Context

- **Language**: TypeScript (strict). **Framework**: Next.js App Router (server components + server actions; no client state library).
- **Data**: Supabase — Postgres + Auth + Storage; RLS per program. Migrations in `platform/supabase/migrations/` (SQL, checked in; applied via Supabase CLI).
- **Jobs**: Inngest (`packet/parse`, `digest/draft` cron, `digest/send`, `announcement/send`, `competition/seed`, `season/rollover-nudge`).
- **Email**: Resend (+ inbound route for email-forward ingestion, seq 7). **PDF**: React-PDF streamed from `app/api/pdf/[doc]/route.ts`. **AI**: Claude API, two prompt families under `lib/ai/prompts/` with zod schemas.
- **Hosting**: Vercel. **Errors**: Sentry. **Rate limiting**: Upstash on `(public)/t/` routes.
- **Testing**: Vitest for unit + RLS integration tests (against local Supabase; pgTAP optional later), Playwright for smoke of the token surfaces and hallway screens. RLS tests run in CI on every migration.

## Project Structure

```
platform/
  app/
    (marketing)/
    (app)/[program]/          # tenant shell: dashboard, roster, costumes, competitions,
                              # events, travel, treasury, comms, settings
    (public)/t/[token]/       # tokenized parent surfaces — no auth, mobile-first
    api/pdf/[doc]/route.ts
    api/inngest/route.ts
    api/webhooks/resend/route.ts
  lib/
    brand.ts                  # single branding source (Constitution IX)
    flags.ts                  # typed flag registry + flag(program, key) helper
    supabase/                 # server/client helpers (SSR, service-role for token routes)
    ai/prompts/               # packet-parse/, digest-draft/ (+ zod schemas, versioned)
    tokens.ts                 # token mint/hash/verify + capability allow-list
  supabase/
    migrations/               # 0001_foundation.sql … (schema + RLS together, always)
    seed.sql                  # demo/seed data
  tests/
    rls/                      # two-program isolation + role-gate suite (CI-blocking)
    unit/
  emails/                     # Resend templates (digest, announcement, invite)
```

## Phase Plan (maps to tasks.md; dependency order from architecture-spec §11)

| Phase | Contents | Depends |
|---|---|---|
| P1 Foundation | App scaffold, brand.ts, flags.ts, full schema migrations (ALL tables + enums + constraints), RLS policies, RLS test suite, auth + tenant shell, memberships/roles UI, settings | — |
| P2 Roster | Students/guardians/ensembles CRUD, size-field config, combined CSV import (preview→commit, health-column skip) | P1 |
| P3 Costumes | Inventory (incl. props/sets), sets, assignment grid + size warnings, alterations queue, checkout grid | P2 |
| P4 Competitions | Competitions CRUD, attendance seed + edit, results, events (+repeat helper), manual itinerary editor, packet upload + parse pipeline + review UI | P2 |
| P5 Travel + PDFs | Trips, rooms/buses, chaperones, one-room-one-bus constraints, all React-PDF outputs | P3, P4 |
| P6 Treasury | Budget builder, ledger + void/audit, budget-vs-actual, per-event cost report, board snapshot | P1 |
| P7 Comms | Announcements, shifts + AI suggestions, digest pipeline, tokenized link layer, deliverability wiring, absence review queue | P2, P4 |
| P8 Lifecycle | Dashboard, rollover wizard, archive read-only, trophy case, export-all, support access, seed data, Sentry | all |

Each phase = one or more Opus 4.8 agent runs; phase output must typecheck (`tsc`), build (`next build`), and keep migrations valid before commit. Fable reviews diffs between phases.

## Constitution Check

- I/III/IV gates: every migration file pairs schema + RLS; no sensitive-PII columns anywhere; AI writes land in draft-status tables only. ✅ designed in.
- VIII: schema complete in P1 even though UI arrives across P2–P8. ✅
- IX: `brand.ts` from P1; CI grep guard against codename strings in UI/email/PDF. ✅

## Risks / Decisions

- **Local Supabase in CI/dev**: RLS tests target `supabase start` (Docker). In environments without Docker, tests are skipped with a loud warning — never silently green.
- **Open decisions** from architecture-spec §14 stand: no family portal, multi-ensemble comps = two rows, email-forward ingestion in P7, sizes schema config in P2.
- Stripe billing, name/domain selection, attorney review are pre-GA checklist items — out of build scope.
