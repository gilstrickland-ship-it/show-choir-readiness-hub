# Tasks: Multi-Ensemble Competitions, Events, and Trips

**Input**: Design documents from `specs/004-multi-ensemble-events/` (plan.md, research.md D1–D8, data-model.md, quickstart.md)

**Tests**: Required — the constitution mandates RLS tests in the same change as the migration; unit + e2e coverage is in the spec's success criteria.

**Organization**: Foundational schema first (blocks everything), then US1 (multi-ensemble competitions, P1), US2 (shared trips, P2), US3 (subset events, P3), then polish/verification.

## Phase 1: Foundational schema (blocking)

- [X] T101 Migration `supabase/migrations/0016_multi_ensemble.sql`: create `competition_ensembles` and `event_ensembles` per data-model.md (denormalized `program_id`, unique pairs, index trio each), standard program-member RLS policy pair for both, backfill from `competitions.ensemble_id` / `events.ensemble_id`, then drop both old columns. Update anything (views/functions/triggers) referencing the dropped columns. (research D1, D2, D7)
- [X] T102 RLS coverage in the same change: extend `tests/rls/fixtures.ts` (new slots) + `tests/rls/seed.ts` with one junction row per table in programs A and B, and add both tables to the isolation sweep + role specs. `npm run test:rls` green.
- [X] T103 [P] Seed update `supabase/seed.sql`: junction-shaped inserts; Central Illinois Invitational carries BOTH demo ensembles (Varsity Mixed + Prep); events keep whole-program semantics as zero junction rows. Idempotency preserved.
- [X] T104 [P] Shared eligibility helper in `lib/` (new or extended module): `competitionRoster(competitionId)` returning distinct active-season students via `competition_ensembles → ensemble_members`, and `competitionEnsembles(competitionId)`; used by every downstream read. Unit tests incl. double-rostered dedup. (research D5)

## Phase 2: US1 — multi-ensemble competitions (P1)

- [X] T105 Competitions create action + form (`app/(app)/[program]/competitions/actions.ts`, `page.tsx`): ensemble multi-select (checkbox group; ≥1 enforced server-side with a clear error), junction inserts, attendance seeding over the union (idempotent upsert, dedup). Replace the "one competition per ensemble" helper copy. (research D3, D4)
- [X] T106 Competition edit (`[competitionId]/page.tsx` + actions): edit participating ensembles; adding seeds that ensemble's members only; removing requires an explicit confirmation naming affected students, then removes attendance ONLY for students in no remaining ensemble and releases their comp-scoped checkouts per Constitution X. Keep the existing "changing the ensemble reseeds attendance" confirm flow as the generalized version.
- [X] T107 [P] Display surfaces: comp-week header + season timeline + dashboard readiness show all participating ensembles (`[competitionId]/page.tsx`, `season/page.tsx`, `dashboard/page.tsx`, `lib/readiness.ts` reads through T104 helper).
- [X] T108 [P] Meals + wardrobe grouping: meal counts (`[competitionId]/meals` + `/api/pdf/meal`) break down per participating ensemble with a distinct-student total; quick-change and checkout (`costumes/quick-change`, `costumes/checkout` + actions) group by ensemble within the comp via the junction. Double-rostered students count once in totals.
- [X] T109 [P] Remaining eligibility reads: parent packet + export ZIP student lists, family token surfaces (`app/(public)/t/[token]/…` absence competition options and itinerary context), packet/absence staff pages — all through T104 helper.

## Phase 3: US2 — shared trips (P2)

- [X] T110 Travel eligibility (`app/(app)/[program]/travel/[tripId]/page.tsx` + travel queries): comp-linked trips draw the unassigned queue/eligible set from the competition roster union; standalone trips unchanged; bus manifest + room sheet PDFs (`lib/pdf/documents.tsx` data loaders) include all assigned students with absence annotations.

## Phase 4: US3 — subset events (P3)

- [X] T111 Events form + actions (`app/(app)/[program]/events/…`): audience selector becomes Whole program / any subset of ensembles (checkbox group); zero junction rows = whole program (dynamic). Calendar + season timeline + event detail label the subset; existing events render unchanged.

## Phase 5: Polish & verification

- [X] T112 [P] Constitution amendment: Principle X wording "a competition's ensemble determines" → "a competition's participating ensembles determine"; rationale in commit; version 1.0.0 → 1.1.0. (research D6)
- [X] T113 e2e updates (`tests/e2e/`): staff journey covers creating a two-ensemble competition (attendance = union), trip queue union, and a subset event; helpers updated for the multi-select form controls.
- [ ] T114 Full gates: `typecheck`, `lint`, `test:unit`, `test:rls` locally where runnable; build; quickstart.md scenarios 1–4 walked in CI/preview; production migration applied via Supabase MCP after PR merge, then live spot-check of demo comp showing both ensembles.
