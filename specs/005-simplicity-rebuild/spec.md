# Feature Specification: Simplicity Rebuild

**Feature Branch**: `claude/simplicity-rebuild-005`

**Created**: 2026-07-27

**Status**: Active — Waves 1–8 specified (inventory: `docs/simplicity-review-2026-07.md` §4)

**Input**: User description: "Review and rebuild the platform's features. Start with the season manager feature for Directors, but do this for all features in the app. It is overly complex now and needs to be super easy to use. Deeply research best practices known from more complex SaaS platforms and use those to make the user experience as simple as possible without losing the required features."

**Research grounding**: `docs/simplicity-review-2026-07.md` — principles P1 (progressive disclosure, two levels max), P2 (opinionated defaults), P3 (minimal create, gather later), P4 (do where you look), P5 (empty states sell the next action), P6 (one list, one truth).

**Constraints (unchanged, non-negotiable)**: per-program RLS isolation; directory-tier PII only; AI drafts never publish; tokenized parent links with a tiny allow-list; flags gate features server-side (`requireFlag` 404s); money void-only; all times rendered in program timezone; server-components-first, `'use client'` only where a form genuinely needs interactivity. Simplification is *presentational and flow-level* — no capability is removed, no schema change is required for Wave 1.

---

## Wave 1 — The season manager (Priority: P1)

### User Story 1 — Add anything to the season, from the Season page (P1)

A director on the Season page presses one **"+ Add"** button, picks Competition / Event / Trip, fills the true minimum (2–3 fields), and lands back on the Season page with the new row visible in the spine. Full details (host school, venue, audience targeting, repeat rules) are added later, where the record lives — or immediately via a "More options" link to the full form.

**Why this priority**: Adding to the calendar is the single most frequent season-management job, and today it costs two pages, an 8–9 field form, and a wrong-way redirect to a module list page.

**Independent test**: From `/[program]/season`, add one of each kind via the drawer; verify each lands back on Season with the row present, and that a competition created with only name+date has status Planned and (in a one-ensemble program) that ensemble attached with attendance seeded.

**Acceptance scenarios**:

1. **Given** a one-ensemble program with an active season, **When** the director opens + Add → Competition and submits name "Midwest Invitational" and a date, **Then** the competition is created with status Planned, the single ensemble auto-attached, attendance seeded, and the browser returns to `/season` showing the new spine row.
2. **Given** a program with three ensembles, **When** the director opens + Add → Competition, **Then** the ensemble checkboxes are visible, all pre-checked, and submitting with none checked is rejected with the existing clear message.
3. **Given** the + Add → Event form, **When** the director enters only a title and a start date/time, **Then** the event is created as kind Rehearsal targeting the whole program; audience targeting and weekly repeat are present but only behind a collapsed disclosure ("Only some groups?" / "Repeats weekly?").
4. **Given** the + Add → Trip form, **When** a competition without a trip exists, **Then** the form's primary path is "For a competition" (select pre-filled with those comps; name/dates inherit on submit), with "standalone trip" fields (name, dates, overnight) as the alternative.
5. **Given** any drawer create fails validation, **Then** the drawer reopens with the existing `?error=` message rendered inside it (roster-page pattern), not on a module page.
6. **Given** a viewer whose role lacks write access for a kind (or whose program has the flag off), **Then** that kind never appears in the drawer; with no addable kinds, no + Add renders (current per-kind gating preserved exactly: `COMPETITION_WRITE_ROLES` × `competitions`, `EVENTS_WRITE_ROLES` × `events`, `TRAVEL_WRITE_ROLES` × `travel`).
7. **Given** a program whose only missing prerequisite is an ensemble, **When** the director opens + Add → Competition, **Then** the drawer says plainly "Competitions need at least one ensemble (a performing group). Create one first →" linking to `/roster/ensembles` — the existing dead-end message, now in one consistent place.

### User Story 2 — Fix a name or date without leaving the spine (P2)

A writer-role member spots a wrong date on the spine, opens a small edit popover on that row, corrects name/date (comps: status; events: start time; trips: dates), saves, and is still on the Season page.

**Why this priority**: Date drift is constant in this domain and today a popover-sized correction costs a full navigation into each record's detail page.

**Independent test**: Edit one row of each kind from the spine; verify persisted values and that deep edits (itinerary, ensembles, rooms) still route to detail pages.

**Acceptance scenarios**:

1. **Given** a comp row on the spine and a `COMPETITION_WRITE_ROLES` viewer, **When** they open the row's Edit popover, change the date, and save, **Then** the spine re-renders with the row in its new chronological position.
2. **Given** an event row, **When** editing, **Then** title, date/time, and location are editable in the popover; audience targeting is not (that's detail-page work, linked from the popover).
3. **Given** a trip row, **When** editing, **Then** the popover reuses the semantics of the existing `updateTrip` action including the room-safety guard on clearing overnight.
4. **Given** a read-only role, **Then** no edit affordance renders on any row.

### User Story 3 — Start the first season where you're told you need one (P2)

A brand-new director who sees "No active season yet" starts one right there — one card, one field (season label, smart-defaulted from today's date, e.g. "2026-27"), optional dates behind a disclosure — and the season is created *and activated* in one submit. The Settings → Seasons wizard remains solely for year-over-year rollover and drops its first-season branch.

**Why this priority**: The current first-run path routes a new director into a six-step *rollover* wizard for what is one INSERT + one activation.

**Acceptance scenarios**:

1. **Given** a program with zero seasons, **When** a `SETTINGS_ROLES` member visits Season or Today, **Then** the alert is replaced by a "Start your season" card with a pre-filled label; one submit creates + activates and returns to the page they were on.
2. **Given** a program with existing seasons but none active, **Then** the card links to Settings → Seasons (rollover/activation is genuinely ambiguous there — which season should be active is a human decision).
3. **Given** a non-settings role, **Then** the card renders as informational ("Your director needs to start the season") without a form.
4. **Given** the rollover wizard, **Then** its steps read in plain language ("Copy costume set names into the new season" not "Re-point costume sets") and the first-season special-casing is gone.

### User Story 4 — A glanceable Season page (P3)

The calendar-subscribe box collapses to a single line ("📅 Subscribe in your calendar") that opens on demand; after a link is minted the fresh-URL state still renders open (the URL is shown once, then never again). The spine reads: header → filters → months. Nothing else claims permanent vertical space.

**Acceptance scenarios**:

1. **Given** a `canManageCalendar` viewer on Season, **Then** the subscribe box renders as a collapsed `<details>` one-liner; opening it shows exactly today's contents (create/regenerate, Google/Apple instructions).
2. **Given** `?calShare=` (fresh mint) or `?calError=`, **Then** the disclosure renders open with the URL/error visible — the one-time-URL privacy flow is unchanged.
3. **Given** any other role, **Then** nothing renders (unchanged).

### Out of scope for Wave 1

- No schema/migration changes; no changes to RLS, tokens, flags, or role sets.
- Module routes (`/competitions`, `/events`, `/travel`) stay live with their full create forms — they become the "More options" target of the drawer (P1's second disclosure level) and keep serving their distinct jobs (events month/week calendar, absences queue, packet attach). Their `#add` anchors keep working.
- Hosting rows on the spine are untouched (hosting has its own command center).
- Comp detail / comp week, itinerary, attendance, meals, packet surfaces: later waves.

### Success criteria (measurable)

- **SC-001**: Adding a competition from Season = 1 page, ≤ 3 inputs touched (one-ensemble program), landing back on Season. (Was: 2 pages, 8 fields, landing on the module list.)
- **SC-002**: Correcting a spine row's date = 0 page navigations.
- **SC-003**: First-season start = 1 submit from the "no season" state. (Was: 6-step wizard entry.)
- **SC-004**: Season page above-the-fold shows spine content: subscribe box ≤ 1 line collapsed, undated-comps note ≤ 1 line (unchanged).
- **SC-005**: `npx playwright test --list` e2e specs statically reconciled; unit + RLS suites and build green; zero new `'use client'` components.

---

## Wave 2 — Trip planning (`travel/[tripId]`) (Priority: P1)

**Diagnosis** (inventory §c-1): 1,368 LOC, 11 forms, 59 inputs; *two competing assignment models* live at once — the `?sel=` two-pane select-then-place flow and the `?fill=` tap-chip queue (T050) — plus group CRUD, chaperones, edit/delete-trip disclosures, conflict banners.

### User Story 5 — One way to load a bus (P1)

A director loading buses picks a group ("Fill Bus 1"), taps names until the meter is full, taps Done. That is the *only* assignment model. The unassigned list becomes a read-only status list ("who still needs a bus/room") with no per-student "Select to place" links; assignment always flows through a fill target.

**Acceptance scenarios**:

1. **Given** a trip with groups, **When** a writer views the page, **Then** each group card's affordance is "Fill" (existing `?fill=` semantics, sticky bar + Done intact) and no `?sel=` links, "Selected — choose a group →" states, or per-group "Assign here" buttons render anywhere. `?sel=` handling is removed from the page; the `assignStudent` action keeps working for the fill flow.
2. **Given** a filled group at capacity, **Then** the capacity meter/warn behavior is unchanged.
3. **Given** the unassigned section, **Then** it lists students with their "needs bus / needs room" chips and absent badges as today, read-only; on phones it stays below the fill queue.
4. **Given** any existing e2e spec exercising `?sel=`, **Then** it is rewritten to the fill flow (behavior parity: same end state).

### User Story 6 — A trip page you can scan (P2)

The page reads as titled sections in constant order — Overview (dates, overnight, linked comp, edit popover) · Schedule · Buses · Rooms · Chaperones · Papers (PDFs) · Danger zone (delete) — each section visible with a one-line summary even when its details are collapsed. No mutation hides behind an unlabeled triangle: every `<summary>` names its contents and shows current state (count/status), matching the app-wide edit idiom (Wave 1's popovers).

**Acceptance scenarios**:

1. **Given** any role, **Then** section headings render in the order above (flag-gated sections omitted cleanly) and each collapsed disclosure's summary line includes its live summary (e.g. "Chaperones · 4 assigned", "Edit trip — Mar 14–15, overnight").
2. **Given** the delete-trip flow, **Then** it sits last under "Danger zone" with the existing confirm semantics.
3. **Given** conflict/`?error=` states, **Then** messages render inside the section they concern, not as page-top banners the user must map back.

---

## Wave 3 — Comp week (`competitions/[id]`) (Priority: P1)

**Diagnosis** (inventory §c-2, §c-13): 1,004 LOC re-implementing light versions of child routes (attendance toggles, itinerary summary, meals count) while the child routes remain; ensemble-change confirm replays the record via 9 hidden inputs; the packet→publish pipeline is 6 decisions across 3 routes with no step indication.

### User Story 7 — The hub stops duplicating its spokes (P1)

The comp page becomes a true hub: header (name, date, status, ensembles, countdown, packet PDF) + readiness rail + one glance card per area (Attendance · Itinerary · Meals · Packet · Shifts · Travel · Results) showing live status ("41 expected · 2 absent") and linking to the child route. Inline editing that duplicates a child route is removed; editing that has no child route (Results entry, Edit details, ensemble membership) stays, using the standard edit idiom.

**Acceptance scenarios**:

1. **Given** a comp with attendance/itinerary/meals data, **Then** the hub shows per-area status lines sourced from the same queries the readiness rail already uses (no new per-area heavy queries), each linking to its tab; the inline attendance toggle grid and duplicated itinerary/meal editing are gone from the hub.
2. **Given** the ensemble-change flow, **Then** confirmation carries only `competitionId` + the new ensemble ids + `confirm=1` (the action re-reads current state server-side) — the 9-hidden-input replay is gone.
3. **Given** phones in comp week, **Then** Today's comp-week shortcuts and the tab strip still reach attendance/checkout in the same number of taps.
4. **Given** the packet pipeline (`packet` flag on), **Then** packet, review, and itinerary pages share a 5-step indicator — Uploaded → Parsed → Reviewed → On itinerary → Published — rendered from existing status fields; each step links to its surface when reachable. No pipeline behavior changes.

---

## Wave 4 — Money (`treasury`, `treasury/budget`) (Priority: P2)

**Diagnosis** (inventory §c-4, §c-7): add-entry = 9 fields with three parallel categorization selects; 8-control filter row; correction vocabulary ("Re-enter (from voided entry)", "Save re-entry"); budget page = 9 forms across 3 hierarchy levels.

### User Story 8 — Recording money is four decisions (P1)

Add entry asks: In or out? · Amount · Who ("Paid to / received from") · What (memo). One collapsed "Connect it (budget line · competition · trip · receipt)" disclosure holds the three tag selects + file upload. Defaults: date today, nothing connected. The uncategorized nudge (already good) is the follow-up path — categorize later, in place.

**Acceptance scenarios**:

1. **Given** the add-entry drawer, **Then** exactly 4 always-visible inputs + the one disclosure; submitting with the disclosure untouched creates an uncategorized entry exactly as today's minimal path does.
2. **Given** the correction flow, **Then** vocabulary is task-language: "Fix this entry" → "Void it" / "Void & redo" (form pre-filled, button "Save corrected entry"); void-never-delete semantics and ledger triggers untouched.
3. **Given** the filter row, **Then** it collapses to Search + Season/Kind + one "More filters" disclosure holding the rest; default view unchanged.
4. **Given** the budget builder, **Then** per-category "Add line" and "Category settings" are two separately-labeled affordances (no combined `Add line · category settings` summary), and line edit uses the standard edit idiom. Hierarchy and treasurer-only writes unchanged.

---

## Wave 5 — Comms (Priority: P2)

**Diagnosis** (inventory §c-12): digest lives on two overlapping routes (`/comms` landing card with approve/discard/send + `/comms/digest` full workspace); shifts page invents a third inline-edit convention (`?edit=` whole-card mode switch); the `announcements` flag exists but is never checked.

### User Story 9 — One home for the weekly digest (P1)

`/comms` remains the landing (staffing + deliverability + signup-link asides are its real job) but its digest card becomes a *status* card — state, one primary action, link to `/comms/digest` for everything else. The workspace owns draft/edit/approve/send/history exclusively. No action exists on both pages.

**Acceptance scenarios**:

1. **Given** a draft digest, **Then** the landing card shows state + "Review & send →" linking to the workspace; approve/discard/send forms exist only in the workspace.
2. **Given** the digest-off state, **Then** the current not-enabled card behavior is preserved.
3. **Given** shifts editing, **Then** the `?edit=` mode switch is replaced by the standard `<details>` edit popover per shift row; create stays a drawer; signup counts, share-link block, and attach-to semantics unchanged.
4. **Given** `lib/flags.ts`, **Then** the `announcements` flag is *wired*: `/comms/announcements` requires it (in addition to `comms`) and the compose affordances hide without it. Default stays on — no behavior change for existing programs. (Decision: wire, don't delete — the flag registry documents it as a real product lever.)

---

## Wave W — Wardrobe (the costume manager's whole job) (Priority: P1 — runs after Wave 5)

**Why this wave exists**: it was missing from the original plan and the user caught it. Wardrobe deserved a wave from the start — the architecture spec (§4) calls the costume system *the wedge*, `costume_manager` is a first-class seat whose entire product this is, and §4 explicitly says "Props and set pieces are just kinds here — **one inventory, no extra screens**." Today the surface is **six sub-tabs across 2,909 LOC** (Alterations 369 · Inventory 286 · Sets 234+156 · Assignments 370 · Quick change 305 · Checkout 322, plus a 22-line dead `alterations` redirect stub), and it is the one domain that never adopted a single Wave-1–4 idiom: **zero `<details>` disclosures anywhere**, so every mutation is a permanently-expanded form.

**Diagnosis**
- **Six tabs, four real jobs.** The costume manager's actual jobs are: *keep the inventory*, *decide who wears what*, *get it altered*, and *hand it out on comp day*. "Sets" and "Assignments" are two halves of one job (a set is just the grouping assignments hang off); "Quick change" is a derived read-only sheet, not a place you go to do something.
- **Quick change is the highest jargon density in the product** — a matrix of costume-set *transitions* as columns × students as rows, one grid per ensemble, horizontally scrolling, with nothing on the page teaching the model.
- **Inventory's filter row is six selects** (kind / set / condition / …), the same pattern Wave 4 collapsed on the ledger.
- **Checkout is genuinely good** (phone-first tap-to-toggle, idempotent seeding) and is the model the rest should follow.
- `costume_manager` also has attendance-edit rights (needed for checkout) but no roster access — the nav must make their two-surface world obvious rather than hiding Money/Comms they can't use.

### User Story 13 — Four tabs, not six (P1)

Wardrobe presents the costume manager's four real jobs: **Inventory** (pieces — props and set pieces included, per §4) · **Assignments** (sets and who wears what, one surface) · **Alterations** (the queue, still the landing) · **Checkout** (comp-day hand-out). Quick change stops being a tab and becomes a *printable view* reachable from Checkout and from the comp hub's Wardrobe glance, where it is actually needed.

**Acceptance scenarios**:
1. **Given** any `COSTUMES_ROLES` viewer, **Then** the tab strip shows exactly four tabs, and every capability of the old six is reachable: sets CRUD lives inside Assignments (set picker + set settings disclosure), `sets/[setId]` and `pieces/[pieceId]` remain as detail routes, quick-change is linked from Checkout.
2. **Given** the old `/costumes/sets`, `/costumes/quick-change` URLs, **Then** they still resolve (redirect or render) — no bookmark 404s — and the dead `/costumes/alterations` stub is deleted with its `backTarget` default corrected (this absorbs T143's stub cleanup).
3. **Given** the assignments grid, **Then** size-mismatch warnings, inline alteration status, and the "Props & set pieces" section all behave exactly as today.

### User Story 14 — Wardrobe adopts the app's idioms (P1)

Every Wardrobe mutation moves to the established pattern: create via a `+ Add` drawer, edit via a row-local `<details>` panel that **expands the row** (never a floating popover — `table.members` is a scroll container and clips them, the Wave-4 lesson), section-local errors with `Object.hasOwn` maps, `typeof === "string"` searchParam guards, and every client-posted id resolved in-program before write.

**Acceptance scenarios**:
1. **Given** the inventory filter row, **Then** it collapses to search + kind + one "More filters" disclosure holding the rest, with the unfiltered default view unchanged.
2. **Given** any piece/set/assignment edit, **Then** it happens in a row-local panel with a live-summary `<summary>`, not a permanently-expanded form.
3. **Given** every costumes server action, **Then** it re-checks its write role and resolves posted `piece_id` / `set_id` / `student_id` / `competition_id` / `assignment_id` in-program (the cross-tenant hardening class — `costume_assignments` carries a cross-tenant unique index, so this is not theoretical).

### User Story 15 — Quick change teaches its own model (P2)

The transitions sheet opens with one plain sentence explaining what a column is, prints cleanly, and names each transition in human terms ("Opener → Ballad"), replacing bare set-number jargon.

**Acceptance scenarios**:
1. **Given** the quick-change view, **Then** a one-line explainer precedes the grid ("Each column is a costume change between numbers — what comes off, what goes on."), it is print-friendly, and horizontal scrolling is preserved for wide ensembles. (This supersedes the one-sentence fix parked in Wave 8's T143.)
2. **Given** a program with several ensembles, **Then** each ensemble's grid is separately titled and independently scrollable.

## Wave 6 — People (`roster/[studentId]`) (Priority: P2)

**Diagnosis** (inventory §c-9): 9 forms; five verbs per guardian row (update / email links / resend links / reset email status / remove); three near-synonym send actions in `roster/actions.ts`.

### User Story 10 — A guardian row you can parse (P1)

Each guardian row shows name, contact, delivery status, and exactly two affordances: **Send family links** (one action — the `emailGuardianLinks`/`resendGuardianLinks` near-synonyms merge into one server action with one label) and **Edit** (standard popover holding update fields, "Mark deliverable again", and Remove-with-confirm).

**Acceptance scenarios**:

1. **Given** a guardian with a bounced address, **Then** the row's status chip shows it and Edit contains the reset action; after editing the email, status resets exactly as today.
2. **Given** the merged send action, **Then** audit/token semantics are identical (one canonical path; the redundant action deleted, call sites updated).
3. **Given** `/roster/email-issues`, **Then** each row carries an in-place fix affordance (link to the student's Edit-guardian popover anchor), ending the dead-end.
4. **Given** the student edit form and deactivate/reactivate flows, **Then** unchanged except grouped visually: Profile · Sizes · Guardians · Status.

---

## Wave 7 — Hosting (`hosting/[eventId]`) (Priority: P3)

**Diagnosis** (inventory §c-3): 948 LOC, 9 forms, 6 blind disclosures — nothing visible until opened, nothing labels what's inside.

### User Story 11 — A host command center that shows its state (P1)

Same section order treatment as Wave 2 US6: Overview (edit popover with live summary) · Visiting schools (table visible, per-row edit popovers) · Schedule (slots table visible; "Generate schedule" as a clearly primary action with its options inside; "Add a slot" secondary) · Day-of documents. Every summary line carries live counts ("Visiting schools · 6").

**Acceptance scenarios**:

1. **Given** a hosted event with schools and slots, **Then** schools and schedule render as visible tables without opening anything; only *mutations* sit in labeled disclosures.
2. **Given** generate-schedule, **Then** its behavior (deterministic generator, shift-remaining) is unchanged; the form simply lives under the primary button's disclosure with its current fields.
3. **Given** the 8 toast-only searchParams, **Then** they collapse into the shared flash convention (Wave 8) or at minimum into one `?ok=<key>` map.

---

## Wave 8 — System pass (cross-cutting) (Priority: P2 — small, high-leverage)

1. **Mobile nav backfills by role** (`MobileNav.tsx`): tab slots become the first N *visible* nav items for the viewer (preserving today's order preference: dashboard, season, roster, costumes, then treasury, comms, hosting) so a treasurer sees Money as a tab, board members see Money/Hosting. "More" keeps the remainder + Settings + Getting started.
2. **One SubTabs component** replacing the six copies; `CompetitionTabs` joins the same visual class (fixes the `settings-tabs`/`subtabs` split).
3. **One ShareLinkCard component** for the three duplicated mint/regenerate blocks (season calendar · itinerary broadcast · shift signup), parameterized by resource; copy and privacy flow preserved.
4. **One flash-message helper**: a server component `<Flash sp={searchParams} map={…} />` rendering ok/error from a per-page map — replaces the hand-rolled chains as surfaces are touched (full sweep not required in one task; hotspot pages first: shifts, hosting, trip, treasury).
5. **Dead-weight cleanup**: remove the never-read `support_access` flag from the registry (the real gate is `support_access_until` — document that in the registry comment); wire `announcements` (Wave 5); collapse `/costumes/alterations` stub (point `backTarget` default at `/costumes`, delete the stub route); single `TIMEZONES` source in `lib/`; delete the `program` tier alias or comment it as intentional (keep — it's documented intent; no change).
6. **Quick-change teaches its model**: one muted sentence above the grid ("Columns are costume changes between numbers — what comes off, what goes on — for each performer.") — jargon P6 fix, no structural change.

**Acceptance**: behavior-preserving refactors verified by the full gate + e2e listing; mobile nav change verified by role in visual QA; no flag semantics change except `announcements` wiring.

---

## Wave 9 — Tutorials & first-use refresh (Priority: P1 at the end — runs LAST, after Waves 1–8)

**Why last** (user directive 2026-07-27): the guide system (spec 003 — role journey panels, the eight IntroStrips, parent welcome card) was written against the *pre-rebuild* UI, and its strip list tracks the old complexity hotspots. Once the rebuild lands, guidance must be re-derived from the new flows — and every strip re-justified: a surface that became self-evident loses its strip rather than keeping stale hand-holding (guidance is a symptom; the rebuild treated causes).

### User Story 12 — First-use guidance that matches the rebuilt app (P1)

A brand-new director's journey panel walks the *new* happy path: start the season in place (Wave 1 card) → add students → ensemble → add a competition from the Season + Add drawer. Every journey step's link, label, and data-verifier points at the rebuilt affordance. Each of the eight IntroStrips is re-evaluated against its rebuilt surface: rewritten to describe the new UI, shortened, or removed where the surface now explains itself. The parent welcome card is reviewed against the (unchanged) parent surface.

**Acceptance scenarios**:

1. **Given** a fresh director on Today, **Then** the journey panel's steps trace the rebuilt flows exactly (no step links to a module-page `#add` anchor or the rollover wizard for a first season) and each step's completion verifier still turns green when the action is done the new way.
2. **Given** each `STRIP_SURFACE_KEYS` surface post-rebuild, **Then** its strip either describes the current UI accurately or is removed from the registry; `?help=1` re-trigger and per-member Got-it state semantics unchanged for surviving strips.
3. **Given** the non-director journeys (treasurer, costume manager, board orientation), **Then** their steps reflect the rebuilt Money/Wardrobe/report surfaces (including the Wave-8 mobile nav, so "where to find it" copy is true on phones).
4. **Given** `tests/e2e`, **Then** the guide contracts (panel headings, step links) are updated coherently with the rebuilt targets in the same change.
5. **Given** the `guide` flag off, **Then** nothing renders (unchanged).

---

## Wave S — Tenant-isolation remediation (SECURITY, authorized schema exception)

**Status**: escalated to the user 2026-07-27 and **approved** ("do all the work for me"). This is the RQ-3 escalation path being exercised, not a violation of it: RQ-3 says a wave that discovers a schema need must stop and escalate — it did, and the user authorized the schema change. Wave S is therefore the one wave in this feature permitted to ship a migration.

**Origin**: the Wave-2 adversarial review confirmed a cross-tenant write in `assignStudent`; an 8-domain audit then found the same class across ~33 program-scoped tables. **This is pre-existing (not introduced by the rebuild) and live in production.**

**The class**: tables carry `program_id` plus SINGLE-COLUMN FKs to other program-scoped tables. RLS write policies check only `has_role(row.program_id)` — never that the *referenced* rows belong to that program. Server actions insert client-posted UUIDs after `requireRole(claimed programId)` without resolving them. Since `/launch` lets any signed-in user self-create a program as director, an attacker can stamp their `program_id` onto rows pointing at another program's records.

**Confirmed impact**: (a) two cross-tenant READS — `share_links.resource_id` is a polymorphic soft reference with no FK (mint in your program, point at a victim resource, read student PII through the token surface), and packet documents laundered via a service-role path; (b) attacker-controlled free text (`travel_chaperones.name_override`, shift signups) rendering into a victim program's parent-facing PDFs and export ZIPs, because service-role PDF/export queries selected children by parent id with no program filter; (c) invisible, undeletable rows that permanently block legitimate inserts (unique indexes are not RLS-filtered) and make "Delete trip"/"Delete group" fail silently while redirecting as success; (d) the one-room-one-bus trigger silently skipping its invariant (SECURITY INVOKER lookup returns NULL cross-tenant).

**Production pre-flight (run 2026-07-27, read-only)**: **clean — 0 poisoned rows** across 15 key relationships. No exploitation has occurred; the migration will apply without any data purge.

### Requirements

- **S-1 (schema, `0017_tenant_fk_integrity.sql`)**: `unique (id, program_id)` on every program-scoped parent; every vulnerable child FK re-created as a COMPOSITE FK on `(ref_id, program_id)` preserving each constraint's existing ON DELETE behavior exactly. Engine-enforced, so it holds against direct API and service-role writes — which application checks alone cannot. Trigger `enforce_one_group_per_kind_per_trip` → SECURITY DEFINER with an explicit cross-program assertion; sweep all other triggers for the same invoker-RLS blind spot.
- **S-2 (safety)**: the migration must FAIL LOUDLY and early if poisoned rows exist — never delete data — with a companion read-only pre-flight script listing offenders per table.
- **S-3 (actions, defense in depth)**: every write resolves client-posted UUIDs with `.eq("program_id", …)` (plus natural parent scope) before use; denormalized values (e.g. a posted `kind`) are read off the resolved row, never trusted; UI-only constraints (eligibility lists, dropdown option sets) are re-derived server-side; DB FK rejections surface as friendly section-local messages, not 500s.
- **S-4 (service-role paths)**: `lib/pdf/queries.ts` and `lib/export-run.ts` scope every child read by `program_id` — tenant scoping is those files' own responsibility, not their callers'.
- **S-5 (share_links)**: polymorphic `resource_id` verified in-program at BOTH mint and resolve; capability allow-list stays tiny.
- **S-6 (tests)**: an RLS suite that, for each vulnerable table, attempts the exact cross-tenant poisoning insert and asserts DB rejection; plus a same-program regression test that the one-room-one-bus trigger still fires.
- **S-7 (deploy)**: production is at `0015`; `0016_multi_ensemble` is merged on main and REQUIRED by deployed code but was never applied (spec 004's T114 left unchecked) — competitions currently render with no ensembles and creates half-fail. Both `0016` and `0017` must be applied, in order. Claude cannot apply DDL here (blocked by the environment's safety classifier); the operator runs `supabase db push`.

## Coverage — every route is owned by a wave (user directive: nothing skipped)

The original plan targeted the complexity hotspots and left 13 of the app's 53 page routes unassigned. That was a gap, not a judgement: a review that skips surfaces cannot claim the product is simple. Every route below now has an owning wave.

| Wave | Routes owned |
|---|---|
| 1 Season | `season`, create paths on `events`/`travel`, first-season start |
| 2 Trip planning | `travel`, `travel/[tripId]` |
| 3 Comp week | `competitions/[competitionId]`, `…/packet`, `…/packet/[parseId]/review` |
| 4 Money | `treasury`, `treasury/budget` |
| 5 Comms | `comms`, `…/digest`, `…/announcements`, `…/shifts`, `…/shifts/suggest` |
| W Wardrobe | all 9 `costumes/*` routes |
| 6 People | `roster`, `roster/[studentId]`, `roster/email-issues`, **+ `roster/ensembles`, `roster/ensembles/[ensembleId]`, `roster/import`, `roster/settings`** |
| 7 Hosting | `hosting`, `hosting/[eventId]` |
| 8 System pass | cross-cutting (nav, shared components, dead weight) |
| **10 Comp-week children** | `competitions` (list), `…/attendance`, `…/meals`, `…/itinerary`, `competitions/absences` |
| **11 Calendar & records** | `events`, `events/[eventId]`, `history`, `dashboard` (Today) |
| **12 Money reporting** | `treasury/budget-vs-actual`, `treasury/reports` |
| **13 Settings & entry** | `settings`, `settings/members`, `settings/export`, `settings/rollover`, `launch`, `invite/[inviteId]` |
| **14 Parent surface** | `t/[token]` + `absence`/`itinerary`/`signup`/`unsubscribe`, `link-help` |
| 9 Tutorials | runs LAST, after every wave above |

Waves 10–14 run after Wave 8 and before Wave 9. Each carries the same cross-wave requirements (RQ-1..RQ-6) and the same idioms.

## Wave 10 — Comp-week children (Priority: P2)

The hub (Wave 3) now delegates to these; they must be worth arriving at. `competitions/absences` currently bare-`notFound()`s for the wrong role instead of rendering `<Restricted>` (the app-wide convention). The itinerary editor is 593 lines with 6 forms and a two-step publish; attendance and meals are thin and mostly fine.

- **AC-1**: The itinerary editor adopts the standard idioms — per-item row-local `<details>` edit (expanding, not floating), one drawer for "Add an item", section-local errors — and keeps the publish→confirm gate and living-itinerary semantics exactly (parents must never see unpublished times).
- **AC-2**: `competitions/absences` renders `<Restricted>` for disallowed roles; Confirm/Dismiss keep their outcome emails (Constitution IV path unchanged).
- **AC-3**: The `competitions` list keeps its distinct jobs (unattached-packet attach, absence-queue nudge) but its create form defers to the Season drawer as the primary path.
- **AC-4**: Attendance and meals get plain-language headers and the shared flash convention; no behavior change.

## Wave 11 — Calendar & records (Priority: P2)

- **AC-1**: `events` month/week calendar keeps both views; its create form becomes the "More options" target of the Season drawer (one create path, per P6), and event detail adopts the row/edit idioms.
- **AC-2**: `history` (trophy case) is a read surface — verify it needs nothing beyond plain language and the shared flash convention.
- **AC-3**: `dashboard` (Today) is re-verified end-to-end after every wave changed what it links to: every inbox row, readiness row, comp-week shortcut and aside card must point at a surface that still owns that job (Wave 3 moved several).

## Wave 12 — Money reporting (Priority: P3)

- **AC-1**: `budget-vs-actual` and `reports` adopt the Wave-4 vocabulary and the collapsed-filter idiom; the board-snapshot PDF and reconciliation "reconciled through" line are unchanged (fiduciary controls stay exactly as designed).

## Wave 13 — Settings & entry (Priority: P2)

`settings` stacks three unrelated admin concerns under one form (program details · email health · support access · share links). `launch` duplicates the `TIMEZONES` array.

- **AC-1**: `settings` becomes titled sections in constant order (Program · Share links · Email health · Support access) with mutations in labeled disclosures; `members` and `export` adopt the row-edit idiom.
- **AC-2**: `settings/rollover` gets the full plain-language pass Wave 1 started (it is now rollover-only) and a real step indicator.
- **AC-3**: `launch` and `invite` share one `TIMEZONES` source (absorbs part of T143) and keep their multi-state flows; the program-creation path keeps its role assignment.

## Wave 14 — Parent surface (Priority: P2)

The inventory rated this the healthiest part of the product (2/5) — this wave is verification-and-polish, not a rebuild, and it must not add complexity to the one surface that got it right.

- **AC-1**: Every parent route is re-verified after the staff-side changes (published-only gates, token capability allow-list unchanged, no PII beyond directory tier).
- **AC-2**: Copy and dates re-checked in program timezone; tap targets ≥44px; the absence/signup outcomes still email.
- **AC-3**: `link-help` keeps its enumeration-safe, rate-limited behavior verbatim.

## Cross-wave requirements

- **RQ-1**: Every wave passes `typecheck` · `test:unit` · `test:rls` · `build`, statically reconciles `tests/e2e`, and keeps `npx playwright test --list --config playwright.config.e2e.ts` clean.
- **RQ-2**: No new `'use client'` components anywhere in Waves 1–8.
- **RQ-3**: No schema migrations. (Everything above is flow/presentation; if implementation discovers a schema need, stop and escalate.)
- **RQ-4**: Visual QA per wave: screenshots of changed surfaces (desktop + 375px) + rendered-contrast check; watch the `@layer` collision class (T061/T066 family) for any new CSS utility.
- **RQ-5**: Copy: plain language; keep the health-info caution label on qualifying free-text fields; keep the "Do not enter…" and AI-draft-approval invariants visible where they are today.
- **RQ-6 — Leave it cleaner (user directive 2026-07-27)**: every wave *removes or factors out* what it replaces — no layering new UI over old code paths. Concretely: (a) replaced UI, branches, and actions are deleted in the same wave, not orphaned; (b) new UI larger than ~100 lines is extracted into sibling server-component files, never inlined into an already-large page; (c) each wave's verification includes a dead-code check over the files it touched (unreferenced exports, unreachable branches, obsolete CSS classes, stale `?param` handling) and reports net LOC on hot files; (d) schema: these waves make no schema changes (RQ-3), so no tables should ever be impacted — if a wave's flow change strands a column/enum value/flag, that's an escalation, not a silent leftover. Wave 8 remains the dedicated sweep for *pre-existing* dead weight (stub routes, dead flags, duplicated components).
