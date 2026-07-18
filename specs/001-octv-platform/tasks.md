# Tasks: Octv Platform

**Input**: `specs/001-octv-platform/` — spec.md, plan.md, data-model.md, architecture-spec.md (authoritative)

**Execution model**: Fable plans/reviews; each task or task group is executed by an Opus 4.8 coding agent. A phase is done when `tsc` passes, `next build` passes, migrations are syntactically valid, and phase-relevant tests exist. Mark tasks `[X]` when complete.

**Format**: `[ID] [P?] Description` — `[P]` = parallelizable within its phase once phase prerequisites are met. All paths relative to `platform/` unless noted.

## Phase P1 — Foundation (blocks everything)

- [X] T001 Scaffold Next.js App Router app in `platform/` (TS strict, ESLint), with route groups `(marketing)`, `(app)/[program]`, `(public)/t/[token]`, `api/pdf/[doc]`, `api/inngest`; add `lib/brand.ts` (env-driven, Constitution IX) and `lib/flags.ts` (typed registry + `flag(program, key)`).
- [X] T002 Foundation migration set in `supabase/migrations/`: all enums + all 35 tables from data-model.md with constraints, indexes, triggers (updated_at, one-room-one-bus, single-active-season/budget) — schema complete per Constitution VIII.
- [X] T003 RLS migration: enable RLS everywhere; membership read policies, role write policies per §2 matrix, archived-season write blocks; storage bucket policies.
- [X] T004 RLS test suite in `tests/rls/` (Vitest against local Supabase): two-program seed; per-table cross-tenant read/write denial; role gates (admin cannot write ledger; treasurer can); archived season rejects writes. CI workflow `.github/workflows/platform-ci.yml` (typecheck, build, RLS tests when Docker available — loud skip otherwise).
- [X] T005 Supabase SSR client helpers (`lib/supabase/`), auth flow (staff sign-in, invite acceptance), tenant shell layout resolving program + membership + role, role-aware nav, Settings → Members (invite, re-role, remove) and Settings → Program (name, timezone, colors), feature-flag plumbing (server-side 404 gating).

## Phase P2 — Roster (needs P1)

- [X] T006 Students + guardians CRUD (server actions + pages under `(app)/[program]/roster/`), soft-delete with §9 invariant cascade, size-field config in Settings (program-defined `sizes` jsonb keys).
- [X] T007 Ensembles + season-scoped `ensemble_members` management (multi-ensemble membership, voice parts, roles).
- [X] T008 Combined CSV import: upload → parse → preview with per-row validation errors + health-column keyword skip notice → commit (students + multi-guardians). `lib/roster/import.ts` + tests in `tests/unit/`.

## Phase P3 — Costumes (needs P2)

- [X] T009 Inventory CRUD: `costume_pieces` (kinds incl. prop/set_piece), `costume_sets`, program-level persistence, condition/storage fields.
- [X] T010 Assignment grid (students × pieces per set, sizes surfaced inline, mismatch warning chips), alterations queue view sortable by next competition.
- [X] T011 Per-competition checkout: idempotent seed of `costume_checkouts`, phone-first tap-to-toggle grid, absent students greyed (reads attendance).

## Phase P4 — Competitions (needs P2; parallel with P3)

- [X] T012 Competitions CRUD + `competition/seed` (attendance expected-seed, idempotent), attendance edit screen (mobile-first), results form (placement/captions/score) + `status='done'` prompt.
- [X] T013 [P] Events (`events` table UI): CRUD + materialized repeat helper; calendar week/month views.
- [X] T014 Manual itinerary editor (items CRUD, kinds, sort) + publish flow (gates per §9 invariant 3) + PDF-alongside layout.
- [X] T015 Packet parse pipeline: upload → Storage → `documents` → Inngest `packet/parse` (extract/rasterize → Claude vision, zod-validated JSON, `prompt_version` recorded) → validation pass → review screen (source pages side-by-side with editable itinerary). Prompts in `lib/ai/prompts/packet-parse/`. Draft-only per Constitution IV.

## Phase P5 — Travel + PDFs (needs P3+P4)

- [X] T016 Trips + travel groups (rooms/buses, capacity, chaperones incl. guardian refs), two-pane assignment UI with unassigned queue + capacity meters (warn, never block); one-room-one-bus trigger already in P1 schema — surface violations kindly.
- [X] T017 React-PDF renderers in `api/pdf/[doc]/`: bus manifest (✓ columns, chaperone line, absent annotations, med-binder checklist line), room sheet (+door-slip variant), parent packet (itinerary + groups + meals + shift roster), board snapshot. Auth-checked, streamed, brand from `lib/brand.ts`.

## Phase P6 — Treasury (needs P1; parallel with P2–P5)

- [X] T018 Budget builder (categories/lines, income/expense, template seeder), treasurer-only writes.
- [X] T019 Ledger: entry form (cents, receipts to Storage), void + re-enter flow, `ledger_audit` writes, running ledger view with filters, Uncategorized nudge.
- [X] T020 [P] Budget-vs-actual view, per-event cost report (competition/trip tags), board snapshot data feed (PDF in T017).

## Phase P7 — Comms + token layer (needs P2+P4)

- [X] T021 Token infrastructure: `lib/tokens.ts` (mint/hash/verify, capability allow-list, revocation), `token_events` logging, per-IP + per-token rate limiting, guardian-token embed helper for emails.
- [X] T022 `(public)/t/` surfaces (mobile-first, no auth): published itinerary, signup page (browse + claim/cancel), absence report form → `absence_requests` review queue for staff.
- [X] T023 Announcements: compose + ensemble filter + immediate Resend send + history; `announcement_sends` tracking; guardian-token footer links.
- [X] T024 Shifts: CRUD, attach to competition/trip/event, "suggest shifts" draft action (from itinerary items + costume set transitions, drafts only).
- [X] T025 Digest pipeline: Inngest cron gather (next 7 days) → Claude draft → review/edit/approve UI → send via Resend with per-family links; reminder-never-autosend; `digests`/`digest_sends`. Prompts in `lib/ai/prompts/digest-draft/`.
- [X] T026 Deliverability: Resend webhook route → `guardians.email_status`, dashboard bounce chip, unsubscribe honored; inbound email-forward ingestion route → documents → parse pipeline.

## Phase P8 — Lifecycle (needs all)

- [ ] T027 Dashboard: next-comp countdown, alterations queue, open shifts, balance, bounce chip, send-failure surfacing.
- [ ] T028 Season rollover wizard (copy ensembles, returning-student prompts, graduate seniors, re-point costume sets) + archive (read-only via RLS) + trophy case (results history).
- [ ] T029 Export-all (async zip: roster/guardians/ledger CSVs + generated PDFs, email link) and program deletion (30-day soft window documented).
- [ ] T030 Support access (`profiles.is_support`, `support_access_until` consent, banner, logging), seed/demo data (`supabase/seed.sql`), Sentry wiring both app + Inngest.

## Dependencies summary

P1 → P2 → {P3, P4} → P5; P1 → P6 anytime; {P2, P4} → P7; all → P8. Within a phase, tasks run in listed order unless marked [P].
