# Research: Multi-Ensemble Competitions, Events, and Trips

## D1 — Relationship shape: junction tables, not arrays

**Decision**: Two new junction tables, `competition_ensembles` and `event_ensembles`, each carrying denormalized `program_id` (Constitution I). `competitions.ensemble_id` and `events.ensemble_id` are dropped after backfill (VIII: no half-migrated dual-read paths). Trips need no new table — travel eligibility derives through the trip's competition's junction rows.

**Rationale**: uuid[] arrays would break FK integrity, make RLS-scoped joins awkward, and complicate the roster-through-`ensemble_members` reads (Constitution VI). Junction tables reuse the exact policy shape every other program-scoped table already has, and the RLS isolation sweep pattern (tests/rls) extends mechanically.

**Alternatives considered**: (a) keep `ensemble_id` nullable + junction for extras — rejected: permanent dual-source ambiguity; (b) uuid[] column — rejected: no FKs, worse queries.

## D2 — Whole-program events: empty set means "everyone", stored as zero rows

**Decision**: `events.ensemble_id` today is `null` for whole-program. Keep that exact semantic in the junction world: an event with zero `event_ensembles` rows targets the whole program (dynamic — ensembles added later are included automatically, per spec assumption). One or more rows = exactly that subset.

**Rationale**: preserves every existing whole-program event with a no-op migration (no rows to create) and matches the spec's "whole-program is not a frozen list".

**Alternatives**: explicit `is_whole_program` boolean — rejected: redundant with row-count and adds an inconsistency state.

## D3 — Competitions require ≥1 ensemble; enforcement lives in server actions

**Decision**: The ≥1-ensemble invariant is enforced in the create/update server actions (reject empty selection) plus a deferred-constraint-free DB posture: no DB-level "at least one child row" constraint (Postgres can't express it cheaply). RLS stays coarse per Constitution I; actions re-check role.

**Rationale**: matches the codebase's existing defense-in-depth split (coarse RLS, fine rules in actions).

## D4 — Attendance seeding and reseed semantics

**Decision**: Extend the existing idempotent seeding (Constitution X) to the union of members across selected ensembles, deduplicated by `student_id`. Adding an ensemble = upsert-seed its members only. Removing an ensemble = confirmed action (the existing "changing ensemble requires a confirmed reseed" pattern generalizes) that deletes attendance rows for students who are members of *no remaining* selected ensemble — students double-rostered in a remaining ensemble are untouched.

**Rationale**: Principle X already demands confirmed reseed on eligibility changes; this generalizes the same flow. Attendance rows key by (competition, student), so dedup is structural.

## D5 — Downstream eligibility reads

**Decision**: Everywhere that resolves "who is in this competition" via `competitions.ensemble_id → ensemble_members` switches to `competition_ensembles → ensemble_members` (distinct students). Meal counts, quick-change, and checkout keep their per-ensemble grouping by joining through `ensemble_members.ensemble_id ∩ competition_ensembles`. Travel eligibility for comp-linked trips reads the same union. Double-rostered students group under each of their ensembles in per-ensemble views but count once in totals and appear once in attendance/travel.

## D6 — Constitution Principle X wording

**Finding**: Principle X currently says "a competition's **ensemble** determines every eligibility list." This feature generalizes it to "a competition's **participating ensembles** determine…". The invariant's spirit (eligibility derives from the competition's ensemble set; changes require confirmed reseed) is unchanged. The implementation commit must include the one-word constitution amendment with rationale and a version bump (1.0.0 → 1.1.0) per Governance. No NON-NEGOTIABLE principle (I, III, IV) is touched.

## D7 — Migration & backfill

**Decision**: One migration that (1) creates both junction tables + RLS policies + indexes, (2) backfills one row per existing competition/single-ensemble event from the old columns, (3) drops the old columns, (4) updates any views/functions that referenced them. RLS tests for both tables land in the same migration change (Constitution: "every migration lands with its RLS policies and RLS tests in the same change"). Seed (`supabase/seed.sql`) updates to the junction shape and makes the demo's Central Illinois Invitational a two-ensemble comp (Varsity Mixed + Prep) per spec assumption.

**Production note**: production carries live rows created via the UI (Heartland Classic, demo comps). The backfill handles them identically to seeds — no manual production surgery needed beyond running the migration.

## D8 — Readiness, PDFs, cost report, packet, share links

**Decision**: all remain singular per competition (spec assumption). PDFs (meal count, parent packet) already group by ensemble via attendance→ensemble_members joins and need only the eligibility-source change. The dashboard's `loadCompReadiness` counts attendance over the union set.
