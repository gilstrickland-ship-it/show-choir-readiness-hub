# Feature Specification: Octv Platform (Season OS for Competitive Show Choir)

**Feature Branch**: `001-octv-platform`

**Created**: 2026-07-17

**Status**: Approved (derived from `architecture-spec.md`, the authoritative source)

**Input**: User-supplied architecture & design spec (`specs/001-octv-platform/architecture-spec.md`). Where this document and the architecture spec disagree, the architecture spec wins.

## Overview

Octv (codename) is the operational backbone for a school's competitive show choir program, serving the director and booster leadership. It tracks money without moving it, generates every travel/costume/meal document from live data, and uses AI strictly backstage as a draft-producer. Parents never get accounts — their entire surface is email plus tokenized links.

The build replaces the front-end prototype at the repo root. The platform lives in `platform/`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Foundation: a program with staff roles and isolated data (Priority: P1)

A director creates a program (school, timezone, tier), invites booster officers (admin, treasurer, costume manager, board members), and each sees exactly what their role permits. Programs never see each other's data.

**Why this priority**: Tenancy + roles + RLS is the substrate every other story runs on; a cross-tenant leak is existential (Constitution I).

**Independent Test**: Seed two programs; assert per-table that program A staff cannot read/write program B rows; assert role write-gates (e.g., admin cannot insert ledger entries); assert archived seasons reject writes.

**Acceptance Scenarios**:

1. **Given** two programs with active members, **When** program A's director queries any domain table, **Then** only program A rows return.
2. **Given** a `board_member`, **When** they open treasury, **Then** they see the full ledger read-only and cannot write.
3. **Given** a role change in Settings → Members, **When** the treasurer seat is re-roled, **Then** ledger write capability follows the role immediately.

---

### User Story 2 - Roster: students, guardians, ensembles, CSV import (Priority: P1)

A director imports the spreadsheet they already have (students + guardians combined), configures the program's size fields, and organizes students into season-scoped ensembles.

**Why this priority**: The roster is the hub everything hangs off; every downstream feature reads through `ensemble_members`.

**Independent Test**: Import a CSV with 80 families including a "allergies" column; verify preview-then-commit, per-row validation errors, health column skipped with notice, students+guardians created, multi-guardian support.

**Acceptance Scenarios**:

1. **Given** a CSV with student/guardian/size columns plus a "medical notes" column, **When** previewed, **Then** the medical column is flagged as skipped and never ingested.
2. **Given** a student in two ensembles, **When** the season's rosters render, **Then** the student appears in both without duplication in `students`.
3. **Given** a student marked inactive, **When** deactivation runs, **Then** costume assignments release, travel assignments clear, and future attendance flips absent.

---

### User Story 3 - Costumes: inventory, assignments, alterations, checkout (Priority: P1)

The costume manager catalogs program-level pieces (including props/set pieces), groups them into season sets, assigns pieces to students with size-mismatch warnings, works an alterations queue, and runs a phone-friendly per-competition checkout grid.

**Why this priority**: The costume system is the product wedge; piece persistence across seasons is the continuity feature.

**Independent Test**: Create pieces, assign to students (one piece → one student per season), generate checkout rows for a competition, toggle check-in/out on a phone-sized viewport, verify absent students grey out.

---

### User Story 4 - Competitions: itineraries, AI packet parse, attendance, results (Priority: P1)

A director uploads a host packet PDF; AI drafts an itinerary shown side-by-side with source pages for review; the director edits and publishes. Attendance seeds as expected for the ensemble and drives every count. After the competition, staff record placement/captions in 30 seconds.

**Why this priority**: The 90-second demo (packet → published itinerary → parent packet) is the sales motion; attendance is the linchpin of all generated documents.

**Acceptance Scenarios**:

1. **Given** a parsed packet, **When** validation finds a time-sequence issue, **Then** the parse lands in `review` with issues annotated — never published automatically.
2. **Given** a failed parse, **When** the director opens the competition, **Then** the manual itinerary editor renders with the PDF alongside.
3. **Given** a published itinerary, **Then** and only then: parent visibility, packet generation, and shift suggestions unlock.

---

### User Story 5 - Travel: trips, rooms, buses, chaperones, PDFs (Priority: P2)

Staff build room/bus groups with capacity meters and a two-pane unassigned queue, attach chaperones (guardian refs or free text), and print room sheets and bus manifests with absent annotations.

**Independent Test**: One student cannot be in two rooms (or two buses) on one trip; over-capacity warns but never blocks; PDFs render from live data.

---

### User Story 6 - Treasury: budget, ledger, void/audit, reports (Priority: P2)

The treasurer builds a fully custom two-level budget, records ledger entries in cents with receipts, voids (never deletes) mistakes, and produces budget-vs-actual and a board snapshot PDF. Optional competition/trip tags yield per-event cost reports.

**Independent Test**: Only treasurer role can write; voided entries excluded from balances but present in audit; unbudgeted entries surface in an "Uncategorized" bucket.

---

### User Story 7 - Comms: announcements, shifts, digest, tokenized links (Priority: P2)

Staff send immediate announcements; volunteer shifts (AI-suggested from published itineraries as drafts) fill via no-login tokenized signup pages; a weekly AI-drafted digest goes out only after director approval, with per-family token links and the standing three-link footer (itinerary, signup, report absence). Bounces surface on the dashboard.

**Independent Test**: A guardian token can only claim/cancel own signups, submit absence requests for own students (into a staff review queue), and view own students' costume status — nothing else. Digest never sends unapproved.

---

### User Story 8 - Season lifecycle: dashboard, rollover, archive, export (Priority: P3)

The dashboard shows next-comp countdown, alterations queue, open shifts, and balance. Season rollover copies ensembles, prompts returning students, marks seniors graduated. Archiving freezes the season read-only (the handoff vault); export-all produces a zip of CSVs + PDFs.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Multi-tenant by `program` with RLS on every domain table; 5 staff roles per the §2 permission matrix; RLS test suite in CI (Constitution I).
- **FR-002**: Parents and students have no accounts; guardian tokens + share links per §8a capability allow-list (Constitution II).
- **FR-003**: Directory-tier PII only; no sensitive-data fields anywhere; CSV import skips health columns by header detection (Constitution III).
- **FR-004**: AI outputs (packet parse, digest draft) always land in draft/review; publish requires explicit staff action (Constitution IV).
- **FR-005**: Money in integer cents; void-never-delete ledger with full audit; treasurer-only writes (Constitution V).
- **FR-006**: All PDFs (packet, bus manifest, room sheet, board snapshot) render on demand via React-PDF from live data (Constitution VI).
- **FR-007**: All times timestamptz UTC, rendered in `programs.timezone` (Constitution VII).
- **FR-008**: Full schema ships wired day one; feature flags (`lib/flags.ts` + `programs.feature_overrides`) gate exposure server-side only (Constitution VIII).
- **FR-009**: Branding via `lib/brand.ts` + env only (Constitution IX).
- **FR-010**: Idempotent seeding for attendance/checkouts; §9 invariants enforced in constraints or server actions (Constitution X).
- **FR-011**: Deliverability wiring: Resend verified domain, bounce/unsubscribe webhooks → `guardians.email_status`, dashboard chip.
- **FR-012**: Support access behind `profiles.is_support` + program consent window, banner + logging; token routes rate-limited with `token_events` logging.

### Key Entities

Full DDL in `data-model.md`; authoritative prose in `architecture-spec.md` §§2–8a. Entity groups: tenancy (programs, seasons, ensembles, profiles, program_members) · roster (students, guardians, ensemble_members) · costumes (costume_sets, costume_pieces, costume_assignments, costume_checkouts) · competitions (competitions, competition_results, attendance, documents, packet_parses, itineraries, itinerary_items, events) · travel (trips, travel_groups, travel_assignments, travel_chaperones) · treasury (budgets, budget_categories, budget_lines, ledger_entries, ledger_audit) · comms (shifts, shift_signups, announcements, announcement_sends, digests, digest_sends) · tokens (guardian_tokens, share_links, token_events).

## Success Criteria *(mandatory)*

- **SC-001**: RLS suite green in CI: zero cross-program reads/writes possible across every table; role gates hold.
- **SC-002**: The 90-second demo works end-to-end: upload real host packet → reviewed/published itinerary → generated parent packet containing that program's actual bus and room lists.
- **SC-003**: A director can import an 80-family CSV and have a working roster (students, guardians, ensembles) in under 10 minutes without hand-entry.
- **SC-004**: No AI-generated content can reach a guardian email without a recorded staff approval.
- **SC-005**: A leaked guardian token exposes exactly one family's signups/absence/costume-status surface — verified by capability tests.
- **SC-006**: Product rename requires editing `lib/brand.ts` + env vars only (verified by grep: no codename strings in UI/PDF/email templates).
