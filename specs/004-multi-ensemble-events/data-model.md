# Data Model: Multi-Ensemble Competitions, Events, and Trips

## New tables

### competition_ensembles

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| program_id | uuid not null → programs(id) | denormalized for RLS (Constitution I) |
| competition_id | uuid not null → competitions(id) on delete cascade | |
| ensemble_id | uuid not null → ensembles(id) | |
| created_at | timestamptz not null default now() | |

Constraints: `unique (competition_id, ensemble_id)`. Index on `(program_id)`, `(competition_id)`, `(ensemble_id)`.
Invariant (server-action enforced): every competition has ≥ 1 row.

### event_ensembles

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| program_id | uuid not null → programs(id) | denormalized for RLS |
| event_id | uuid not null → events(id) on delete cascade | |
| ensemble_id | uuid not null → ensembles(id) | |
| created_at | timestamptz not null default now() | |

Constraints: `unique (event_id, ensemble_id)`. Same index trio.
Semantics: zero rows for an event = whole program (dynamic); ≥1 rows = exactly that subset.

## Dropped columns (after backfill)

- `competitions.ensemble_id` — backfill: `insert into competition_ensembles (program_id, competition_id, ensemble_id) select program_id, id, ensemble_id from competitions where ensemble_id is not null`.
- `events.ensemble_id` — backfill: same shape; `null` (whole-program) rows produce no junction rows.

## RLS policies

Both tables copy the standard program-member policy pair used by sibling tables (select for program members; write for program members — fine-grained role checks stay in server actions), plus the archived-season write freeze if the pattern applies to their parents (competitions are season-scoped through their parent; junction writes follow the competition's season state the same way attendance does today).

## Derived reads (no schema)

- **Competition roster**: `select distinct em.student_id from competition_ensembles ce join ensemble_members em on em.ensemble_id = ce.ensemble_id and em.season_id = <active> where ce.competition_id = $1` — replaces every `competitions.ensemble_id` eligibility read (attendance seeding, meals, quick-change, checkout sync, travel eligibility, packet/PDF student lists, readiness counts).
- **Per-ensemble grouping** (meals, quick-change, checkout): group the same join by `ce.ensemble_id`; a double-rostered student appears under each of their ensembles in grouped views but `distinct` in totals.
- **Event audience**: zero `event_ensembles` rows → all program ensembles; else the listed subset.
- **Trip eligibility**: trips keep `competition_id`; comp-linked trips read the competition roster above; standalone trips unchanged.

## State transitions

- **Add ensemble to competition**: insert junction row → idempotent attendance upsert-seed for that ensemble's members (skip students already seeded).
- **Remove ensemble from competition**: confirmed action → delete junction row → delete attendance rows for students in no remaining selected ensemble → release their costume checkouts/travel assignments for that competition per the existing deactivation invariant (Constitution X); double-rostered students untouched.
- **Ensemble deleted from program**: existing behavior governs; junction rows cascade only if ensembles delete does today (verify: ensembles likely soft-block when referenced — keep consistent).

## Test surface

- RLS: cross-tenant denial sweep rows for both junction tables (extend tests/rls fixtures/seed with `a`/`b` rows, slots ≥ next free).
- Unit: seeding dedup (double-rostered), removal semantics, whole-program event audience resolution.
- e2e: create two-ensemble comp → attendance covers both; trip queue shows union; per-ensemble meal breakdown.
