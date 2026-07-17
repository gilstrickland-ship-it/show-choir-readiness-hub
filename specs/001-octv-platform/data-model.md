# Data Model: Octv Platform

Authoritative column-level sketches live in `architecture-spec.md` §§2–8a — implement those tables **verbatim in intent**. This document adds the conventions, constraints, and glue the SQL sketches leave implicit. Migrations live in `platform/supabase/migrations/` and every migration pairs schema with its RLS policies and gets covered by `platform/tests/rls/`.

## Conventions (apply to every table)

- `id uuid primary key default gen_random_uuid()`.
- Every domain table carries denormalized `program_id uuid not null references programs(id)` with an index (`idx_<table>_program`), even when reachable via a parent — this is what keeps RLS one-hop.
- `created_at timestamptz not null default now()`; add `updated_at` (trigger-maintained) on tables with edit UIs (students, guardians, costume_*, itineraries, itinerary_items, budgets, budget_lines, shifts, events, competitions, trips, travel_groups).
- All monetary values `bigint` cents, `CHECK (amount_cents > 0)` where stated.
- All times `timestamptz` (UTC); rendering in `programs.timezone` is app-layer.
- Enums as Postgres enum types, named `<table>_<column>` (e.g. `program_member_role`), created in the foundation migration.
- Soft-delete via status enums where specified (students, program_members); ledger entries void via `voided_at`, never delete.

## Table inventory (30 tables, all in the P1 foundation migration set)

**Tenancy**: `programs`, `seasons`, `ensembles`, `profiles`, `program_members` — §2.
**Roster**: `students`, `guardians`, `ensemble_members` — §3.
**Costumes**: `costume_sets`, `costume_pieces`, `costume_assignments`, `costume_checkouts` — §4.
**Competitions**: `competitions`, `competition_results`, `attendance`, `documents`, `packet_parses`, `itineraries`, `itinerary_items` — §5; `events` — §5a.
**Travel**: `trips`, `travel_groups`, `travel_assignments`, `travel_chaperones` — §6.
**Treasury**: `budgets`, `budget_categories`, `budget_lines`, `ledger_entries`, `ledger_audit` — §7.
**Comms**: `shifts`, `shift_signups`, `announcements`, `announcement_sends`, `digests`, `digest_sends` — §8.
**Tokens**: `guardian_tokens`, `share_links`, `token_events` — §8a, §10 (token_events: id, program_id, token_kind enum('guardian','share'), token_id, action, ip inet, at timestamptz).

(34 total counting profiles/token_events; the "30" is the domain core — don't sweat the number, implement the list.)

## Constraints beyond the sketches

- `seasons`: at most one `is_active` per program (partial unique index).
- `budgets`: unique active budget per season (partial unique on `(season_id) where status='active'`).
- `costume_assignments`: `UNIQUE(season_id, piece_id)`.
- `costume_checkouts`: `CHECK (assignment_id IS NOT NULL OR piece_id IS NOT NULL)`.
- `attendance`: `UNIQUE(competition_id, student_id)`; `competition_results`: `UNIQUE(competition_id)`.
- `ensemble_members`: `UNIQUE(season_id, ensemble_id, student_id)`.
- `travel_assignments`: `UNIQUE(travel_group_id, student_id)` **plus** one-room-one-bus per trip: enforce with a constraint trigger (kind lives on `travel_groups`) — on insert/update, reject a second assignment for the same `(trip, student)` among groups of the same kind.
- `shift_signups`: `UNIQUE(shift_id, guardian_id)` where `guardian_id` is not null.
- `guardian_tokens.token` / `share_links.token`: store **hash only** (sha256), unique index on hash; raw token ≥128-bit random, minted app-side, shown/embedded once.
- `ledger_entries`: `entered_by`/`voided_by` reference `profiles(id)`; `voided_at` null = live row; balances always computed excluding voided.
- Absence requests (parent-submitted, §5): model as `absence_requests` (id, program_id, competition_id, student_id, guardian_id, note, status enum('pending','confirmed','dismissed'), created_at, resolved_by, resolved_at) — the staff review queue the token surface writes into. **+1 table, part of P1 schema.**
- Digest director-notes field (§8 gathering input): `digest_notes` text column on `digests` is NOT right — notes precede the draft; put `weekly_note` text on `programs` (editable in comms UI) for MVP.

## RLS pattern (every domain table)

```sql
-- read: active member of the program
using (program_id in (select program_id from program_members
                      where user_id = auth.uid() and status = 'active'))
-- write: same, plus role check per the §2 matrix (writes also re-checked in server actions)
-- archived seasons: season-scoped tables add `and not exists (select 1 from seasons s
--   where s.id = season_id and s.archived_at is not null)` on write policies
```

- `profiles`: user reads/updates own row; program peers readable via membership.
- Token-surface tables (`shift_signups`, `absence_requests`) are written by the service-role context only — no anon policies; the capability allow-list in `lib/tokens.ts` is the boundary (Constitution II).
- Storage buckets: `documents` (packets), `receipts`, per-program path prefix `program_id/...`; policies mirror membership.

## Seeding jobs (idempotent upserts)

- `competition/seed`: upsert `attendance` (expected) for all `ensemble_members` of the competition's ensemble+season; upsert `costume_checkouts` for active assignments. `ON CONFLICT DO NOTHING` on the natural keys. Re-run safe on roster change; changing a competition's ensemble requires confirmed reseed (delete + reseed in one transaction).
