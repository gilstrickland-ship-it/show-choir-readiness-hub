# Quickstart Validation: Multi-Ensemble Competitions, Events, and Trips

Prerequisites: local stack (`supabase start` + `supabase db reset`) or CI; `npm run build`; e2e stack per `.github/workflows/platform-ci.yml`. Demo seed now puts **both** demo ensembles (Varsity Mixed, 8; Prep, 4) on the Central Illinois Invitational.

## Scenario 1 — Two-ensemble competition (spec US1)

1. Sign in as `director@demo.example` / `test1234`.
2. Season → + Competition → select **both** ensembles → create.
3. Expect: flash "Competition created. Attendance seeded."; comp-week header lists both ensembles; attendance shows 12 students; meal count shows `Varsity Mixed · 8` and `Prep · 4` with total 12.
4. Edit the competition → deselect Prep → expect a confirmation step naming the students whose attendance will be removed → confirm → attendance drops to 8.
5. Re-add Prep → its 4 members seed as expected; the original 8 statuses untouched.

## Scenario 2 — Shared trip (spec US2)

1. On the two-ensemble comp, Travel card → create trip (overnight).
2. Expect: unassigned queue lists all 12 students; assign across buses/rooms; bus manifest PDF (`/api/pdf/bus?trip=…`) contains students from both ensembles.

## Scenario 3 — Subset event (spec US3)

1. Season → + Event → ensemble selector now multi-select (Whole program / any subset).
2. Create an event for 2 of the ensembles → calendar shows both ensemble tags; a whole-program event created before the migration still renders "Whole program".

## Scenario 4 — Migration safety (spec FR-009 / SC-004)

- `supabase db reset` (fresh) and, against a copy of pre-migration data, run the migration: every pre-existing competition ends with exactly one `competition_ensembles` row matching its old `ensemble_id`; whole-program events end with zero `event_ensembles` rows; comp-week/season/meals/travel/PDF renders are unchanged.

## Automated gates

- `npm run typecheck` · `npm run lint` · `npm run test:unit` (new dedup/audience tests) — all green.
- `npm run test:rls` — isolation sweep covers `competition_ensembles` and `event_ensembles` (cross-tenant read/write denied).
- e2e suite — staff journey updated for the multi-select form; all specs green in CI.
