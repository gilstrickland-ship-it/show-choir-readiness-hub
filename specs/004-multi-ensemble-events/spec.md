# Feature Specification: Multi-Ensemble Competitions, Events, and Trips

**Feature Branch**: `004-multi-ensemble-events`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Multi-ensemble competitions, events, and trips. Programs often send more than one show choir (ensemble) to the same competition, and share the same calendar events and travel. Today a competition belongs to exactly one ensemble (competitions.ensemble_id), the add-competition form says 'create one competition per ensemble', events are either whole-program or a single ensemble, and trips inherit a single competition's one ensemble for travel eligibility. Change this so: (1) a competition can include one or more of the program's ensembles, chosen at creation and editable later; attendance is seeded for every member of every selected ensemble; meal counts and quick-change/checkout continue to group by ensemble within the competition; the season timeline and comp-week pages show all participating ensembles; (2) events can target the whole program, one ensemble, or any subset of ensembles; (3) trips attached to a multi-ensemble competition draw travel-eligible students from all of that competition's ensembles (standalone trips unchanged). Existing single-ensemble competitions must keep working unchanged (backfill/migration). Wardrobe assignments remain per costume-set/ensemble as today. RLS isolation rules unchanged."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register one competition for several ensembles (Priority: P1)

A director whose program fields both a varsity and a prep ensemble registers for an invitational that both groups attend. They create **one** competition, select both ensembles on the form, and everything downstream — attendance, meal counts, readiness, the season timeline — covers every student from both groups. When plans change (prep drops out, or a third group is added), the director edits the competition's ensemble list and downstream data adjusts.

**Why this priority**: This is the core ask. Most multi-ensemble programs attend the same competitions together; forcing one competition record per ensemble splits attendance, meals, documents, and money tagging across duplicate records for what is one real-world event.

**Independent Test**: Create a competition with two ensembles selected; verify attendance is seeded for the members of both, the comp-week page groups students correctly, and the meal count reports a per-ensemble breakdown plus a correct total.

**Acceptance Scenarios**:

1. **Given** a program with two ensembles (8 and 4 active members), **When** the director creates a competition selecting both, **Then** attendance is seeded "expected" for all 12 students and the comp-week header lists both ensembles.
2. **Given** a competition with two ensembles, **When** the director removes one ensemble from it, **Then** that ensemble's students no longer appear in the competition's attendance/meals, and any of their existing attendance rows are removed only after an explicit confirmation.
3. **Given** a competition with one ensemble, **When** the director adds a second ensemble to it later, **Then** the new ensemble's members are seeded "expected" without disturbing the existing attendance statuses.
4. **Given** an existing single-ensemble competition created before this change, **When** any page reads it, **Then** it behaves exactly as before (its one ensemble shows as the only participant).
5. **Given** the add-competition form, **When** the director selects no ensemble, **Then** creation is rejected with a clear message (at least one ensemble required).

---

### User Story 2 - One trip carries everyone who is going (Priority: P2)

The director creates a trip for a multi-ensemble competition. The trip's unassigned queue offers every student from **all** of the competition's ensembles, so both groups ride the same buses and share the same room blocks, and the printed manifests cover everyone.

**Why this priority**: Travel is the second-biggest pain: shared buses and hotel blocks are the norm when multiple groups attend together. Without this, the one-bus reality can't be modeled.

**Independent Test**: Attach a trip to a two-ensemble competition; verify the travel page's unassigned queue lists students from both ensembles and the bus manifest PDF includes them all.

**Acceptance Scenarios**:

1. **Given** a trip linked to a two-ensemble competition, **When** the director opens the trip's travel page, **Then** the unassigned queue contains the union of both ensembles' active members.
2. **Given** students from two ensembles assigned to one bus, **When** the bus manifest is downloaded, **Then** all assigned students appear (with their absence annotations as today).
3. **Given** a standalone trip (no competition), **When** the travel page loads, **Then** eligibility behaves exactly as it does today.

---

### User Story 3 - Calendar events for any subset of ensembles (Priority: P3)

A director schedules a joint rehearsal for two of three ensembles. The event form allows choosing the whole program, one ensemble, or any subset; the season timeline and family-facing surfaces label the event with the participating ensembles.

**Why this priority**: Valuable but lower stakes — the existing "whole program" option already covers the most common shared-event case; subsets add precision.

**Independent Test**: Create an event targeting two of three ensembles; verify the calendar shows it labeled with both ensembles and (if events surface to families) only the right families see it highlighted.

**Acceptance Scenarios**:

1. **Given** three ensembles, **When** an event is created for two of them, **Then** the event stores and displays exactly those two ensembles.
2. **Given** an existing whole-program or single-ensemble event, **When** it is viewed or edited after this change, **Then** its targeting is preserved and editable into any subset.

---

### Edge Cases

- Removing an ensemble from a competition that already has attendance marks, meal counts, or costume checkouts for that ensemble's students: the system must warn and require confirmation before discarding those rows (or must keep them clearly flagged — resolution decided in planning; the spec requires an explicit, non-silent path).
- A student who belongs to two selected ensembles (double-rostered) must appear exactly once in attendance, meals, and travel eligibility.
- Deleting an ensemble from the program while it participates in competitions/events: blocked or cascaded consistently with how ensemble deletion behaves elsewhere today.
- The per-event cost report, packet parse, itinerary, share links, and readiness must treat the competition as one unit (no per-ensemble duplication of those artifacts).
- Ensemble-scoped wardrobe surfaces (quick-change, checkout) continue grouping by ensemble within the shared competition.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A competition MUST be able to include one or more of its program's ensembles; at least one is required.
- **FR-002**: The add-competition and edit-competition forms MUST allow selecting multiple ensembles, and the "one competition per ensemble" guidance copy MUST be removed/replaced.
- **FR-003**: Creating a competition MUST seed attendance ("expected") for every active member of every selected ensemble, deduplicated per student.
- **FR-004**: Adding an ensemble to an existing competition MUST seed attendance for its members without altering existing rows; removing one MUST require explicit confirmation before its members' attendance rows are removed.
- **FR-005**: Meal counts MUST break down by ensemble within the competition and total across all participating ensembles.
- **FR-006**: Comp-week, season timeline, dashboard readiness, and family-facing itinerary surfaces MUST display all participating ensembles for a competition.
- **FR-007**: A trip attached to a competition MUST draw travel-eligible students from the union of that competition's ensembles; standalone trips are unchanged.
- **FR-008**: An event MUST be able to target the whole program, a single ensemble, or any subset of ensembles; existing events keep their current targeting.
- **FR-009**: All existing single-ensemble competitions and single/whole-program events MUST be migrated without any user-visible change in behavior.
- **FR-010**: New relationship data MUST be program-scoped with the same tenant-isolation guarantees (and cross-tenant denial test coverage) as the records they extend.
- **FR-011**: Quick-change and checkout continue to operate per ensemble within a competition; wardrobe assignments remain per costume set as today.

### Key Entities

- **Competition participation**: the set of ensembles attending a competition (competition ↔ ensemble, many-to-many, at least one per competition).
- **Event targeting**: the set of ensembles an event applies to (event ↔ ensemble, many-to-many; empty set = whole program, preserving today's semantics).
- **Travel eligibility**: derived — the union of active members of a trip's competition's participating ensembles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A director can register a two-ensemble competition in one pass — a single create action yields complete attendance for both groups with zero duplicate competition records.
- **SC-002**: For a program with N ensembles attending together, the number of competition records to manage per real-world event drops from N to 1.
- **SC-003**: Bus manifests and room sheets for a shared trip include 100% of assigned students across all participating ensembles.
- **SC-004**: Every pre-existing competition, event, and trip renders identically before and after the migration (spot-checked across season, comp-week, meals, travel, and PDFs).
- **SC-005**: Cross-tenant isolation tests pass for all new relationship data (zero rows readable or writable across programs).

## Assumptions

- A competition's itinerary, host packet, parse runs, share links, cost report, and readiness remain singular per competition (not per ensemble).
- "Whole program" remains a first-class targeting choice for events and is stored so that ensembles added later are automatically included (i.e., whole-program is not expanded to a frozen list).
- Attendance-derived surfaces (meals, manifests, checkout greying) already read per-student attendance and continue to; only the seeding source set changes.
- Double-rostered students (member of two selected ensembles) are rare but must not produce duplicate rows anywhere.
- The demo seed will be updated to showcase a multi-ensemble competition (both demo ensembles on one competition) since that is the flagship story.
- Results/trophy case records remain per competition; if a program wants per-ensemble placements at the same invitational, they may still create separate competitions (existing behavior remains available).
