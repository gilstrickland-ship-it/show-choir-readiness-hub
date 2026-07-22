# Implementation Plan: Multi-Ensemble Competitions, Events, and Trips

**Branch**: `claude/ai-key-environment-name-f3dc3a` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-multi-ensemble-events/spec.md`

## Summary

Replace the one-ensemble-per-competition/event model with junction tables (`competition_ensembles`, `event_ensembles`), derive every eligibility list from the union of a competition's participating ensembles (deduplicated per student), extend the create/edit forms to multi-select, and migrate all existing rows with zero behavior change. Trips need no schema change — comp-linked trips read the new union. Full design in [research.md](./research.md) and [data-model.md](./data-model.md); validation script in [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript (Next.js 15 App Router, server components + server actions)
**Primary Dependencies**: Supabase (Postgres 17 + RLS), React-PDF, Vitest, Playwright
**Storage**: Postgres via Supabase; migration in `supabase/migrations/`, seed in `supabase/seed.sql`
**Testing**: `test:unit` (Vitest), `test:rls` (Vitest vs embedded Postgres), e2e (Playwright vs local Supabase stack in CI)
**Target Platform**: Vercel (prod), local dev
**Project Type**: Multi-tenant web app
**Performance Goals**: no material change; the union read adds one join on indexed columns
**Constraints**: RLS coarse + server-action role checks; idempotent seeding; timestamptz everywhere
**Scale/Scope**: ~35 files reference `ensemble_id`; 1 migration; 2 new tables; forms on competitions + events; eligibility reads in attendance/meals/quick-change/checkout/travel/PDFs/readiness

## Constitution Check

| Principle | Status |
|---|---|
| I Tenant isolation | PASS — junction tables carry denormalized `program_id`, standard policies, RLS tests land in the same migration change |
| II Staff-only accounts | PASS — no auth surface change |
| III Minimal PII | PASS — no new PII fields |
| IV AI draft-only | PASS — untouched |
| V Money tracked | PASS — cost report stays per-competition |
| VI Derived documents / roster via ensemble_members | PASS — reads still flow through `ensemble_members`, sourced from the junction |
| VII timestamptz | PASS — no time columns |
| VIII Build complete, flag exposure | PASS — old columns dropped after backfill, no dual-path; no flag needed (behavior-preserving for existing data) |
| IX Name-agnostic | PASS |
| X Idempotent seeding & invariants | **PASS with amendment** — Principle X's wording "a competition's ensemble determines every eligibility list" generalizes to "participating ensembles"; same invariant spirit (confirmed reseed on eligibility change). Implementation commit includes the one-word amendment + rationale + version bump 1.0.0 → 1.1.0 per Governance. |

Post-design re-check: no violations introduced by Phase 1 artifacts.

## Project Structure

### Documentation (this feature)

```text
specs/004-multi-ensemble-events/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions D1–D8
├── data-model.md        # tables, backfill, derived reads, transitions
├── quickstart.md        # validation scenarios
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source code touchpoints (implementation)

```text
supabase/migrations/00XX_multi_ensemble.sql   # tables + policies + backfill + drops
supabase/seed.sql                             # junction-shaped seed; demo comp gets both ensembles
lib/…                                         # shared eligibility helpers (roster resolution, readiness)
app/(app)/[program]/competitions/…            # create/edit multi-select, comp-week header, attendance seeding actions
app/(app)/[program]/events/…                  # subset multi-select, calendar labels
app/(app)/[program]/travel/…                  # eligibility union for comp-linked trips
app/(app)/[program]/costumes/…                # quick-change/checkout grouping through junction
app/(app)/[program]/dashboard/…, season/…     # participating-ensemble display, readiness
app/(public)/t/[token]/…                      # family surfaces reading competition rosters
app/api/pdf/…, lib/export-zip.ts, lib/pdf/…   # student lists via union
tests/rls/fixtures.ts, seed.ts, specs         # junction rows in A/B programs + isolation sweep
tests/unit/…                                  # dedup, removal semantics, audience resolution
tests/e2e/…                                   # multi-select form flows
.specify/memory/constitution.md               # Principle X amendment (1.1.0)
```

## Phase 0 → 1 outputs

- [research.md](./research.md): D1 junction tables · D2 empty-set-=-whole-program events · D3 ≥1-ensemble enforcement in actions · D4 seeding/reseed semantics · D5 eligibility reads · D6 constitution amendment · D7 migration/backfill · D8 singular artifacts.
- [data-model.md](./data-model.md): schemas, constraints, RLS, derived reads, state transitions, test surface.
- No `contracts/` directory: the app exposes no external API; interfaces are internal server actions and pages (validated behaviorally via quickstart + e2e).
- [quickstart.md](./quickstart.md): four validation scenarios + automated gates.
