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

- [X] T027 Dashboard: next-comp countdown, alterations queue, open shifts, balance, bounce chip, send-failure surfacing.
- [X] T028 Season rollover wizard (copy ensembles, returning-student prompts, graduate seniors, re-point costume sets) + archive (read-only via RLS) + trophy case (results history).
- [X] T029 Export-all (async zip: roster/guardians/ledger CSVs + generated PDFs, email link) and program deletion (30-day soft window documented).
- [X] T030 Support access (`profiles.is_support`, `support_access_until` consent, banner, logging), seed/demo data (`supabase/seed.sql`), Sentry wiring both app + Inngest.

## Dependencies summary

P1 → P2 → {P3, P4} → P5; P1 → P6 anytime; {P2, P4} → P7; all → P8. Within a phase, tasks run in listed order unless marked [P].

## Phase 9: Convergence

- [X] T031 Build the meal count form — per-competition headcount (expected − absent) per ensemble with a non-health logistics note field, as a staff screen plus a React-PDF `meal` doc in `api/pdf/[doc]` per arch §9 map / §1.7 / US4 (missing)
- [X] T032 Add staff minting/revocation for `share_links` — broadcast read-only links minted on itinerary publish and from the shifts page (signup browse mode), listed/revocable in settings, per FR-002 / arch §8a (partial)
- [X] T033 Build the quick-change grid — costume set transitions in sort_order × assigned students per competition, absent students greyed, per arch §3/§4/§9 (missing)
- [X] T034 Implement tier→flag-bundle mapping in `lib/flags.ts` — flag resolution becomes override ?? tier-bundle default ?? code default, with Prep/Varsity/Program bundles, per FR-008 / arch §12 (partial)
- [X] T035 Persist support-session audit — durable queryable log of support views (who, program, when) replacing console/breadcrumb-only logging, per arch §10 (partial)
- [X] T036 Make export-all an async job with email-link delivery (Inngest + Storage upload + Resend link), keeping sync download as dev fallback, per T029 / arch §13.2 (partial)
- [X] T037 Add `season/rollover-nudge` spring reminder cron per arch §10 Inngest list (missing)
- [X] T038 Move announcement and digest sending onto Inngest jobs for retry/batching per arch §10, keeping the no-key graceful mode (partial)
- [X] T039 Return real HTTP 429 responses on rate-limited `(public)/t/` requests (route-handler or middleware layer) per arch §10 hardening (partial)
- [X] T040 Surface a read-only banner on pages rendering archived-season data per arch §9 invariant 4 (partial)
- [X] T041 Sweep codename strings from code comments so the SC-006 grep is fully clean per Constitution IX (partial)

## Phase 10 — Product review polish (July 2026)

- [X] T042 Bug sweep from July 2026 product review: absences date anchor, stale Overview-tab copy, raw ISO dates (comp board view, checkout picker, events week heading, rollover seasons), calendar-day countdown on Today, honest magic-link copy, friendly timezone label helper.
- [X] T043 Plain-language sweep from July 2026 review: friendly time-zone labels, enum label maps (itinerary/event kinds, piece condition, budget direction, member status, launch roles), no raw env/flag/model strings in UI, treasury label softening, guardian-link management rewritten without token jargon, import and shift-form wording.
- [X] T044 Parent notification layer: absence outcome + shift confirmation emails, day-before shift reminder cron (reminded_at on shift_signups), unsubscribe (footer link, List-Unsubscribe one-click, guardian unsubscribe page + email:unsubscribe capability).
- [X] T045 Parent-surface UX: add-to-calendar ICS for published itineraries, changed-since-publish banners (parent + staff nudge), enumeration-safe self-service link recovery, 44px token-page tap targets, absence history as cards.
- [X] T046 Staff workflow: first-run setup guide on Today, first-season wizard framing, mobile nav promotes Wardrobe + comp-week hallway shortcuts, fair-share card, bus-manifest Released column + chaperone ratio lines, one-tap travel assignment, parent-page date anchors.
- [X] T047 Final hardening: e2e suite reconciled with redesigned flows, confirm-box on reset-links + guardian/member removal, LIKE-metacharacter-safe address matching everywhere, undated-competition note on Season.

## Phase 11 — Wave 2 roadmap (July 2026)

- [X] T048 Wave F: deliverability runbook + Settings email-health card (F1); Charms/CutTime header synonym packs + grade→grad-year helper + import hint + landing migration card (F2).
- [X] T049 Wave G: season_calendar share links + subscribable staff ICS feed + all-day ICS support (G1); day-grouped itineraries (editor, parent, packet PDF) + multi-day trip schedule view (G2).
- [X] T050 Wave H: travel bulk-assignment flow — fill-target sticky bar + tap-chip queue (querystring-driven, server-rendered), existing flows preserved.
- [X] T051 Wave I1: hosting foundation — migration 0011 (hosted_events/schools/slots + enums + RLS + archived-season freeze), fixtures + isolation/role/archive coverage, hosting flag (default off, no tier bundle), Hosting nav slot + route stub, lib/hosting.ts types.
- [X] T052 Wave I2: hosting surfaces — event list/create, schools + homerooms (dup warn), schedule builder (deterministic generator + shift-remaining), master schedule / door signs / director packet PDFs, Season spine rows, volunteer seam.
- [X] T053 Live-preview QA fixes: truthful link-lifecycle copy on parent expired-link + link-help pages; magic-link unknown-account response made indistinguishable from success (anti-enumeration).
- [X] T054 Wave J convergence fixes: email-address import collision, schedule-generator cadence, host day-of contact (migration 0012), slot/trip/group delete confirms, runbook + email-health subdomain corrections, comms-flag-aware shift links, remaining enum labels, mint error surfacing, webcal variant, tap targets, tz-aware grade mapping, single-source hosting roles.
