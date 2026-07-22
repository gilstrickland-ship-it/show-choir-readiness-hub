# Octv Constitution

Season OS for competitive show choir. Director + booster side. Tracks money, never moves it. AI strictly backstage.

> "Octv" is a working codename only (see Principle IX). This constitution governs the platform build under `platform/`; the legacy Vite prototype at the repo root is reference material only and is not bound by these rules.

## Core Principles

### I. Tenant Isolation Is Existential (NON-NEGOTIABLE)

The tenant is a `program`. Every domain table carries a denormalized `program_id` for simple, fast RLS. One membership table (`program_members`) gates everything. A cross-program data leak is the existential bug for this product: the RLS test suite ships **with** the schema, not after it, and runs in CI on every migration. Keep RLS policies coarse; enforce fine-grained role rules in server actions (defense in depth — server actions re-check role from `program_members`).

### II. Accounts Are for Staff Only — Parents Are Never Users

The login surface is the program's leadership team (director + booster officers, 5–12 accounts per program). The general parent population has zero accounts: they receive email and interact through tokenized no-auth links. Students are records, not users. No feature may introduce parent or student authentication. The tokenized link layer (`guardian_tokens`, `share_links`) is the parents' entire surface: tokens are ≥128-bit random, hashed at rest, revocable, never carry PII in URLs, rate-limited, and constrained to an explicit, deliberately tiny capability allow-list. Parent-originated writes (absence requests) always land in a staff review queue.

### III. Minimal Directory-Tier PII Only (NON-NEGOTIABLE)

Octv holds **only low-sensitivity, directory-tier PII** (student names, grad years, sizes; adult contact info) and categorically excludes every sensitive class: no medical or health data, no allergies or dietary needs, no emergency contacts, no birthdates, no student addresses, no photos, no student accounts. No schema may add a field for these; free-text fields carry a standing "do not enter health or medical information" label; CSV import detects health/medical columns by header keyword and skips them with a notice. The correct external claim is "no sensitive student data; minimal directory data only" — never "no PII." Baseline hygiene applies everywhere: encryption in transit/at rest, RLS isolation, opaque tokens only in URLs, real export and deletion.

### IV. AI Is a Draft-Producer, Never a Publisher (NON-NEGOTIABLE)

Packet parsing and digest drafting always land in `draft` status behind a director review screen. Nothing AI-generated reaches a parent without explicit human approval. No approval by the reminder deadline → reminder, never auto-send. Claude usage is exactly two prompt families (packet parse, digest draft), versioned in-repo under `lib/ai/prompts/` with zod schemas beside them; `prompt_version` and model are recorded on every AI-produced row; token usage is logged per program from day one. AI features must be disableable globally in minutes via feature flags.

### V. Money Is Tracked, Never Touched

All amounts are integers (cents, `bigint`). No payment rails anywhere. Ledger entries void, never delete — corrections are void + re-enter, and `ledger_audit` records everything. Segregation of duties: only the `treasurer` role writes to the ledger and budget; director, admin, and board see everything and change nothing. Financial transparency to the full board is a fiduciary norm: read access for `board_member` covers the full ledger, receipts, budget-vs-actual, and audit log.

### VI. Derived Documents, Live Data

Generated documents (bus manifests, room sheets, meal forms, parent packet, board snapshot) are rendered on demand from live data via React-PDF — never stored as state. A regenerate is always current; no stale-PDF drift. Attendance is the linchpin table every generated document reads through; without it every document silently over-counts. Every roster consumer reads through `ensemble_members` for the active season — never `students` directly.

### VII. Times Are timestamptz, Rendered in Program Timezone

`programs.timezone` (IANA) is set at onboarding; every itinerary/event/shift time is stored UTC and rendered in program tz. A 7:15 AM call time rendered wrong once destroys trust forever.

### VIII. Build Complete, Release by Flag

The platform is built as one whole — the data model ships fully wired from day one; nothing is designed as a later bolt-on and no schema anticipates a "phase 2 migration." Feature flags gate *exposure*, not construction: a typed registry in `lib/flags.ts` + `programs.feature_overrides` jsonb, evaluated server-side only (navigation hides, routes 404 server-side, Inngest jobs no-op). No client-side-only gating anywhere. No third-party flag service.

### IX. Name-Agnostic Codebase

"Octv" is a working codename. All branding (product name, domain, support email, PDF footer, email from-name) flows from a single `lib/brand.ts` config + env vars. No hardcoded product name in UI, PDFs, emails, or metadata. Renaming must be a one-file change plus DNS.

### X. Idempotent Seeding & Invariants

All seeding jobs (checkouts, attendance) are idempotent upserts — safe to re-run when the roster changes. Enforced invariants: deactivating a student releases costume and travel assignments and flips future attendance to absent; a competition's participating ensembles determine every eligibility list, and changing them requires a confirmed reseed; publishing an itinerary gates parent visibility, packet generation, and shift suggestions; archiving a season makes season-scoped data read-only via RLS; students soft-delete only (ledger memos and archives may reference them).

## Technology Constraints

- Stack: Next.js App Router · Supabase (Postgres + Auth + Storage, RLS per program) · Vercel · Resend · React-PDF · Claude API · Inngest.
- Server components + server actions throughout; no client state library.
- Token routes use a service-role server context with explicit capability checks (RLS doesn't apply to anonymous visitors — the allow-list is the security boundary there).
- Mobile-first responsive for the hallway screens (costume checkout, attendance, bus loading) and **all** `(public)/t/` pages; staff desktop-primary elsewhere.
- Deliverability is a first-class concern: verified sending domain, bounce/unsubscribe webhooks wired to `guardians.email_status`, surfaced on the dashboard.
- Sentry (or equivalent) on app and Inngest functions; email send failures surface on the dashboard, not just logs.

## Development Workflow

- Spec-driven (Spec Kit): constitution → spec → plan → tasks → implement. Planning artifacts live in `specs/`; Fable plans, Opus 4.8 implements, and every implementation task traces to a task ID in `specs/*/tasks.md`.
- Dependency-ordered build (foundation → roster → domains → comms); nothing ships to a pilot until the platform stands; flags control per-program exposure.
- Every migration lands with its RLS policies and RLS tests in the same change.
- UI vocabulary follows `vocabulary-dictionary.md` where applicable.

## Governance

This constitution supersedes other practices for the `platform/` build. Amendments require a documented rationale in the amendment commit and a version bump below. Every PR/review verifies compliance with the NON-NEGOTIABLE principles (I, III, IV) before merge; complexity beyond the spec must be justified against Principle VIII (build complete ≠ build extra).

**Version**: 1.1.0 | **Ratified**: 2026-07-17 | **Last Amended**: 2026-07-22
