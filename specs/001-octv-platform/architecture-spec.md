# Octv — MVP Architecture & Design Spec

Season OS for competitive show choir. Director + booster side. Tracks money, never moves it. AI strictly backstage.

Stack: Next.js App Router · Supabase (Postgres + Auth + Storage, RLS per program) · Vercel · Resend · React-PDF · Claude API · Inngest.

---

## 1. Core architectural decisions

1. **Tenant = `program`** (a school's show choir program). Every domain table carries a denormalized `program_id` for simple, fast RLS. One membership table gates everything.
2. **`season` scopes almost everything.** Rosters, competitions, budgets, travel, and digests are season-scoped. Costume *inventory* is program-scoped (pieces persist across years); costume *assignments* are season-scoped. This split is what makes the multi-year archive / board-handoff vault (Program tier) fall out for free.
3. **Accounts are for staff only — parents are never users.** The login surface is the program's leadership team: director plus booster officers (who are themselves parents, but hold staff roles). The general parent population has zero accounts: they receive communications (digest, itineraries, packets) by email and interact through tokenized no-auth links (shift signup, absence report). Students are records, not users. This kills all parent-onboarding friction — nobody has to convince 80 families to create a password.
4. **Attendance is the linchpin table.** Per-competition attendance drives meal counts, bus manifests, room rosters, and costume checkout lists. Without it, every generated document silently over-counts. It exists from day one.
5. **AI is a draft-producer, never a publisher.** Packet parsing and digest drafting always land in `draft` status behind a director review screen. Nothing AI-generated reaches a parent without explicit approval.
6. **Money is integers.** All amounts in cents. Ledger entries are append-friendly with an audit trail; no payment rails anywhere.
7. **Generated documents are derived, not stored state.** Bus manifests, room sheets, meal forms, and the parent packet are rendered on demand from live data via React-PDF. A regenerate is always current; no stale-PDF drift.
8. **Times are timestamptz, rendered in the program's timezone.** `programs.timezone` (IANA) is set at onboarding; every itinerary/event/shift time is stored UTC and rendered in program tz. Competitions cross the Central/Eastern line constantly (the Alabama→Indiana corridor hits it immediately); a 7:15 AM call time rendered wrong once destroys trust forever.
9. **Build complete, release by flag.** The platform is built as one whole — every feature below is required for a functional platform and the data model ships fully wired from day one. Feature flags (§13) gate *exposure*, not construction: features turn on per-program as they're hardened, but nothing is designed as a later bolt-on and no schema anticipates a "phase 2 migration."
10. **Data minimization is architectural, not policy — and the claim is precise.** Octv necessarily holds *some* PII: student names, grad years, sizes, and adult contact info are personally identifiable, and a roster product cannot exist without them. The design commitment is that Octv holds **only low-sensitivity, directory-tier PII** and categorically excludes every sensitive class: **no medical or health data, no allergies or dietary needs, no emergency contacts, no birthdates, no student addresses, no photos, no student accounts.** Health and emergency information is managed entirely outside the system through the school's existing forms process — Octv never asks for it, has no field for it, and free-text fields are labeled "do not enter health or medical information." The correct external claim is "no sensitive student data; minimal directory data only" — never "no PII." Baseline PII hygiene still applies everywhere: encryption in transit/at rest, RLS tenant isolation, no PII in URLs (opaque tokens only), real export and deletion, breach-notification plan.

---

## 2. Tenancy, auth, roles

### Tables

```sql
programs      (id, name, slug, school_name, city, state, timezone /* IANA, e.g. 'America/Chicago' */,
               tier enum('prep','varsity','program'), feature_overrides jsonb default '{}', created_at)
seasons       (id, program_id, label /* "2026–27" */, starts_on, ends_on, is_active, archived_at)
ensembles     (id, program_id, name /* "Varsity Mixed", "Prep" */, sort_order)
profiles      (id /* = auth.users.id */, full_name, phone, avatar_url)
program_members (id, program_id, user_id, role enum('director','admin','treasurer','costume_manager','board_member'),
                 status enum('invited','active','removed'), invited_email, created_at)
-- Staff and board only. Typical program: 5–12 accounts total. General parents never appear in this table.
```

### Role permission matrix (enforced in RLS + server actions)

| Capability | director | admin | treasurer | costume_manager | board_member |
|---|---|---|---|---|---|
| Program settings, members, seasons | ✅ | ✅ | — | — | — |
| Roster CRUD | ✅ | ✅ | — | — | read |
| Costumes CRUD | ✅ | ✅ | — | ✅ | read |
| Competitions / itineraries | ✅ | ✅ | read | read | read |
| Travel rosters | ✅ | ✅ | read | read | read |
| Attendance edit | ✅ | ✅ | — | ✅ | — |
| Ledger + budget write | — | — | ✅ | — | — |
| Treasury read — full ledger, receipts, budget, budget-vs-actual, board snapshot | ✅ | ✅ | ✅ | — | ✅ |
| Shift management | ✅ | ✅ | ✅ | ✅ | — |
| Approve/send digest | ✅ | ✅ | — | — | — |

Parents have no column because parents have no accounts — their surface is email plus tokenized links (see §8a).

Notes:
- Single role per membership (MVP). Most account-holders are parents in real life; the system only knows them as officers.
- **Director and admin can be the same person or different people.** `director` is a strict superset of `admin`, so when one person wears both hats (common in smaller programs), a single `director` membership covers it — no second account, no role stacking. When they're different people (director teaches, booster president runs operations), each gets their own membership. Programs can have multiple `admin` seats (president + VP) and even co-directors; roles are per-membership, not singletons. The semantic difference the roles preserve: `director` is the school-staff seat, `admin` is the booster-leadership seat — identical capabilities today, but the distinction keeps the door open for school-vs-booster divergence later (e.g., district-mandated reporting lands on director only) without a migration.
- **`board_member` is the read-only seat**: general board members (secretary, fundraising chair, members-at-large) who need visibility for votes and meetings. On accounting they see *everything* the treasurer sees — full ledger with entries and attached receipts, budget structure, budget-vs-actual, audit log, board snapshot — just with zero write access. Financial transparency to the full board is a fiduciary norm for booster nonprofits, and it's also the treasurer's protection: nothing is hidden, so nothing is suspected. Operationally they read rosters, itineraries, and travel. A board member who takes on a job gets re-roled (e.g., to `costume_manager`), not stacked.
- **Segregation of duties on money: only `treasurer` writes to the ledger and budget.** Director and admin — like the board — see everything but change nothing. This mirrors how healthy booster nonprofits actually operate (the director requests, the treasurer records) and it protects the director too: a teacher-employee editing a parent nonprofit's books is exactly the entanglement school districts warn about. If the treasurer seat turns over mid-season, the director re-roles the successor in Settings — the write capability follows the role, never the person. Programs wanting a second bookkeeper add a second `treasurer` membership.
- Role changes are one dropdown in Settings → Members, so annual officer turnover is a 2-minute task — re-role the humans, the data doesn't move. This is the handoff story at the account level.
- **No sensitive-data tier exists** because no sensitive data is stored (core decision #10). There is no `student_sensitive` table, no medical fields, no emergency contacts. The chaperone's paper med binder and the school's forms process own that world; Octv's printed sheets carry names and logistics only.
- RLS pattern: every policy is `program_id IN (select program_id from program_members where user_id = auth.uid() and status = 'active')` for reads, plus role checks for writes. Keep policies coarse; enforce fine-grained rules in server actions.

---

## 3. Roster (the hub everything hangs off)

```sql
students          (id, program_id, first_name, last_name, grad_year,
                   sizes jsonb /* {top, bottom, dress, shoe, ...} — free-schema, program-defined keys */,
                   status enum('active','inactive','graduated'), created_at)
-- Deliberately minimal. No DOB (grad_year suffices), no address, no photo, no health fields — see core decision #10.
guardians         (id, program_id, student_id, name, email, phone, relationship,
                   email_status enum('ok','bounced','unsubscribed'))
-- Pure contact records for communications and tokenized links. Never linked to auth users.
ensemble_members  (id, program_id, season_id, ensemble_id, student_id,
                   role enum('performer','band','crew','manager'), voice_part nullable,
                   UNIQUE(season_id, ensemble_id, student_id))
```

Design points:
- `sizes` is jsonb with program-defined keys (Settings lets each program pick its size fields) — programs measure differently; don't fight it with columns.
- A student can be in multiple ensembles in a season (varsity + band for prep is common).
- **Graduation/rollover:** season rollover wizard copies ensembles, prompts to re-add returning students, marks seniors `graduated`. History stays intact for the archive.
- Guardians are the comms directory: the digest, itinerary publications, and tokenized action links all go to `guardians.email`. **One combined CSV import** (student name, grad year, sizes columns, guardian name/email/phone — multiple guardians per student via repeated columns or rows) creates students and guardians together, because that's the shape of the spreadsheet the director already has; entering 80 families by hand would kill onboarding. Import is preview-then-commit with per-row validation errors; health/medical columns in the source spreadsheet are detected by header keywords and explicitly skipped with a notice, never silently ingested.
- **Deleting a student** = soft delete (`inactive`): releases costume assignments (pieces return to inventory), removes from unassigned travel queues, excludes from counts. Never hard-delete — ledger memos and archives may reference them.

Downstream consumers of a roster row: costume assignments, attendance, travel assignments, meal counts, quick-change grids, digest recipients (via guardians). **Every one of those reads through `ensemble_members` for the active season — never `students` directly** — so ensemble/season filtering is consistent everywhere.

---

## 4. Costume system (the wedge)

```sql
costume_sets        (id, program_id, season_id, ensemble_id, name /* "Opener", "Ballad" */, sort_order, notes)
costume_pieces      (id, program_id, set_id nullable, kind /* dress, vest, pants, shoes, accessory, prop, set_piece */,
                     label /* "Dress #14", "Riser 3", "Doorframe wall" */, size_label nullable, color, condition enum('new','good','fair','retire'),
                     storage_location, acquired_season_id nullable, notes)
costume_assignments (id, program_id, season_id, piece_id, student_id,
                     alteration_status enum('none','needed','in_progress','done'),
                     alteration_notes, fitted_at nullable,
                     UNIQUE(season_id, piece_id) /* one piece, one student per season */)
costume_checkouts   (id, program_id, competition_id, assignment_id nullable, piece_id nullable /* direct for props/sets */,
                     checked_out_at nullable, checked_out_by nullable,
                     checked_in_at nullable, checked_in_by nullable,
                     CHECK (assignment_id IS NOT NULL OR piece_id IS NOT NULL))
```

Design points:
- **Pieces are program-level inventory** and survive seasons (`set_id` is the current-season grouping; re-pointing sets each year is part of rollover). This is the data the departing costume parent currently takes with them — its persistence *is* the continuity feature.
- **Props and set pieces ride the same rails.** `kind='prop'/'set_piece'` items live in the same inventory, group into sets, and flow through the same per-competition checkout grid ("did Riser 3 make it back on the truck") — they just skip student assignment (`costume_assignments` not required; checkout rows can attach to a piece directly via nullable `assignment_id` + `piece_id` on `costume_checkouts`). One inventory system, zero extra screens.
- Assignment screen: per set, grid of students × pieces with the student's `sizes` jsonb surfaced inline for suggestion; mismatch (piece `size_label` vs student size) renders a warning chip, never a block.
- Alterations queue view: all assignments where status ∈ (needed, in_progress), sortable by next competition date — this is the costume parent's working screen.
- **Check-in/out per competition:** creating a competition auto-generates `costume_checkouts` rows for every active assignment of that ensemble (via Inngest or on first open of the checkout screen). The checkout screen is a big tap-to-toggle roster grid designed for a phone in a school hallway.
- Ties: attendance ABSENT at a competition → that student's checkout rows render greyed/skipped. Costume set order (sort_order) feeds the quick-change grid ordering.

---

## 5. Competitions, itineraries, and the AI packet pipeline

```sql
competitions     (id, program_id, season_id, ensemble_id, name, host_school, venue_address,
                  date, showchoir_com_url nullable, status enum('planned','confirmed','done'))
competition_results (id, program_id, competition_id, placement /* "2nd Runner-Up", "Grand Champion" */,
                     division nullable, score numeric nullable,
                     captions jsonb /* {"Best Vocals": true, "Best Choreo": true} */, notes,
                     UNIQUE(competition_id))
attendance       (id, program_id, competition_id, student_id,
                  status enum('expected','absent','partial'), note,
                  UNIQUE(competition_id, student_id))
documents        (id, program_id, competition_id nullable, kind enum('host_packet','other'),
                  storage_path, uploaded_by, created_at)
packet_parses    (id, program_id, competition_id, document_id, status enum('queued','running','review','accepted','failed'),
                  model, prompt_version, raw_output jsonb, confidence jsonb, error, created_at)
itineraries      (id, program_id, competition_id, status enum('draft','published'), published_at, source enum('manual','parsed'))
itinerary_items  (id, itinerary_id, program_id, starts_at, ends_at nullable,
                  kind enum('depart','arrive','homeroom','warmup','perform','meal','awards','load','other'),
                  title, location, details, sort_order)
```

### Parse pipeline (Inngest: `packet/parse`)

1. Director uploads host packet (PDF/image/email-forward attachment) → Supabase Storage → `documents` row → enqueue.
2. Extract: text layer if present; else rasterize pages → Claude vision. Always also send page images for layout-heavy packets (schedules are tables).
3. Claude call with strict JSON schema (zod-validated): competition metadata (perform time, homeroom, awards), itinerary items, flagged ambiguities. Temperature low; `prompt_version` recorded on the parse row.
4. Validation pass: times sequence sanity (depart < arrive < warmup < perform), date matches competition date, items missing times flagged. Failures → `status='review'` with issues attached (they go to review regardless — this just annotates).
5. **Review screen: source page images side-by-side with editable parsed itinerary.** Director fixes, then *Publish*. Publishing sets itinerary `published`, visible to parents, and unlocks packet generation.
6. Nothing auto-publishes. Ever. A failed parse degrades gracefully to the manual itinerary editor with the PDF displayed alongside — worst case, Octv is still better than retyping into Google Docs.

### Attendance
- On competition create, `attendance` rows seed as `expected` for all `ensemble_members` of that ensemble+season (same lazy-seed pattern as checkouts).
- Staff own attendance. Parents report absences through a tokenized link in the digest/itinerary email (see §8a): the link is scoped to their guardian record, shows only their student(s), and posts an absence *request* that lands in a staff review queue — staff confirm, attendance flips. No auth, no parent-written state without staff eyes on it.
- **Consumed by:** meal counts (pure headcount: expected − absent per ensemble; dietary accommodations are handled by the program outside Octv — the meal form has a free-text logistics note labeled for non-health info like vendor and serving time), bus manifests (absent students annotated), room sheets (absent annotated), costume checkout (greyed), quick-change staffing.

### Results
- After a competition, staff record the placement, captions, and optional score on the competition page (30-second form, `status='done'` prompts for it). Results render on the dashboard, in the season archive, and in a trophy-case view on the program's history — the emotional payload that makes the multi-year archive loved rather than merely useful. Zero integration with tabulation systems; this is the program's own record.

## 5a. General events (rehearsals, fittings, banquets)

```sql
events (id, program_id, season_id, ensemble_id nullable /* null = whole program */,
        title, starts_at, ends_at nullable, location nullable, note,
        kind enum('rehearsal','fitting','fundraiser','banquet','other'))
```

- Deliberately thin: no attendance, no itinerary, no RSVP — those belong to competitions. Events exist so the weekly digest and dashboard can answer "what's happening this week" completely, because rehearsal schedule changes are the #1 recurring content in real programs' parent comms.
- Recurring rehearsals: created via a simple repeat helper at creation time (materialized as individual rows, editable/deletable individually — no RRULE engine).
- Feeds: digest gathering (§8), dashboard week view, and the program calendar page. Shifts may attach to events via nullable `event_id` (car wash volunteers).

---

## 6. Travel rosters (rooms + buses)

```sql
trips              (id, program_id, season_id, competition_id nullable, name, starts_on, ends_on, is_overnight)
travel_groups      (id, program_id, trip_id, kind enum('room','bus'), label /* "Room 214", "Bus 1" */,
                    capacity int, notes, sort_order)
travel_assignments (id, program_id, travel_group_id, student_id,
                    UNIQUE(travel_group_id, student_id))
travel_chaperones  (id, program_id, travel_group_id, guardian_id nullable, name_override nullable)
-- Chaperones are almost always parents (non-users): reference a guardian for contact info, or free-text for one-off helpers.
```

Design points:
- **`trips` decouple travel from competitions.** A day comp gets an auto-created trip (buses only); overnight invitationals and spring trips set `is_overnight` (rooms + buses). One trip can serve one competition or none (banquet, tour).
- **One student, one room, one bus per trip:** partial unique indexes — unique `(trip, student)` among groups where kind='room', and again where kind='bus' (enforce via constraint trigger since the kind lives on the parent group).
- Assignment UI: two-pane — left, the **unassigned queue** (trip's eligible students = ensemble members minus assigned minus, visually flagged, absent); right, group cards with capacity meters. Tap student → tap group. Over-capacity is a warning, not a block (programs stretch rooms; don't be preachy).
- Chaperones attach per group (bus chaperone, hall parent) as guardian references or free text — no accounts involved. Printed group sheets carry names and logistics only; the school's med forms binder travels with the chaperone as it always has, and the bus manifest includes a static checklist line reminding staff to bring it.
- No rooming-policy engine (gender rules etc.) in MVP — programs' policies vary too much; capacity + eyeballs. Candidate Phase 2 as configurable warnings.
- **Outputs (React-PDF):** Room sheet (per-room list + hall-chaperone summary + door-slip variant), Bus manifest (per-bus checklist with blank ✓ columns for headcounts out/back, chaperone line, absent annotations). Both also embed into the parent packet.

---

## 7. Budget + treasury ledger (track, don't touch)

```sql
budgets           (id, program_id, season_id, name, status enum('draft','active','closed'), UNIQUE active per season)
budget_categories (id, program_id, budget_id, name, direction enum('income','expense'), sort_order)
budget_lines      (id, program_id, category_id, name, planned_cents bigint, sort_order)
ledger_entries    (id, program_id, season_id, entry_date, direction enum('in','out'), amount_cents bigint CHECK > 0,
                   budget_line_id nullable, competition_id nullable, trip_id nullable,
                   memo, counterparty /* payee or source */, receipt_path nullable,
                   entered_by, created_at, voided_at nullable, voided_by nullable, void_reason nullable)
ledger_audit      (id, program_id, entry_id, action enum('create','update','void'), actor, diff jsonb, at)
```

Design points:
- **Fully custom structure:** categories and lines are 100% user-defined per program (two levels is enough; deeper nesting is spreadsheet cosplay). A "start from template" seeder offers common structures (Costumes, Choreography, Travel, Competition fees, Fundraising) as a starting point only.
- **Entries void, never delete.** Corrections = void + re-enter (Gil: this is your reversal-entry instinct from fintech; volunteers understand "void" better than "adjusting entry"). `ledger_audit` records everything; balances exclude voided.
- Unbudgeted entries allowed (`budget_line_id` null) and surfaced in an "Uncategorized" bucket the treasurer is nudged to clear — real bookkeeping happens in that order.
- Optional `competition_id`/`trip_id` tag → free per-event cost report ("what did Show Choir Nationals actually cost us"), which boards love and nothing else in this market offers.
- Views: **Treasury** (running ledger, filters, add-entry), **Budget vs Actual** (per line: planned / actual / variance, income and expense sections, season header totals), **Board snapshot** (read-only summary the treasurer can PDF for the monthly meeting — React-PDF, same pipeline as everything else).
- Receipts: image/PDF upload to Storage, path on entry. No OCR in MVP (Phase 2: Claude extracts amount/payee as *suggested* values — same draft-not-publish rule).

---

## 8. Volunteer shifts + weekly digest

```sql
shifts        (id, program_id, season_id, competition_id nullable, trip_id nullable, event_id nullable,
               title /* "Quick-change crew — Opener→Ballad" */, starts_at, ends_at, needed_count, notes)
shift_signups (id, program_id, shift_id, guardian_id nullable, name, email,
               status enum('confirmed','cancelled'), source enum('token_link','staff_entered'),
               UNIQUE(shift_id, guardian_id))
-- No member_id: volunteers are parents, parents have no accounts. Signups come through tokenized
-- links (guardian_id resolved from the token) or are entered by staff on someone's behalf.
announcements (id, program_id, season_id, ensemble_id nullable /* null = everyone */,
               subject, body_md, status enum('draft','sent'), created_by, sent_at)
announcement_sends (id, program_id, announcement_id, email, resend_id, status)
digests       (id, program_id, week_of, status enum('draft','approved','sent'),
               subject, body_md, model, prompt_version, approved_by, sent_at)
digest_sends  (id, program_id, digest_id, email, resend_id, status)
```

Design points:
- **Announcements are the "right now" channel** the weekly digest can't be: "buses running 30 min late, pickup now 11:45." Compose (staff, mobile-friendly), optional ensemble filter, send immediately via the same Resend pipeline with the same guardian-token footer links. No AI, no approval queue — the human writing it *is* the approval. Announcement history lives on the program so the next board can see what got communicated when. (True SMS is a documented Phase 2 want — Twilio — but email blast covers pilots; deliverability speed is minutes, not hours.)
- Shifts attach to a competition, a trip, an event (car wash), or nothing. After an itinerary publishes, a **"suggest shifts"** action drafts quick-change, meal, and load crew shifts from itinerary items + costume set transitions (set N → set N+1 implies a quick-change window) — drafts for the director to edit, per the AI rule.
- Signup surface is a no-login tokenized page (see §8a): open slots by event, tap to claim, done. The digest links straight to it. This plus the published itinerary is the Facebook-group killer — and it works exactly like the SignUpGenius links parents already trust.

## 8a. The tokenized link layer (how parents interact without accounts)

This is the parents' entire surface, so it gets designed deliberately rather than bolted on:

```sql
guardian_tokens (id, program_id, guardian_id, token /* long random, hashed at rest */,
                 created_at, revoked_at nullable)
share_links     (id, program_id, resource enum('itinerary','packet','signup_page'), resource_id,
                 token, expires_at nullable, revoked_at nullable)
```

- **Two token kinds.** `share_links` are broadcast, read-only, one token for everyone (published itinerary, parent packet, the signup page in browse mode). `guardian_tokens` are per-family, long-lived, and identify *who* is acting — every email to a guardian embeds their token in the links, so tapping "sign up" or "report absence" already knows the family. No login, no password, no account.
- **Capabilities of a guardian token (MVP, exhaustive):** claim/cancel own shift signups; submit an absence request for own student(s); view own students' costume assignment + alteration status. Read-mostly, and the one write that touches operations (absence) goes to a staff review queue. A leaked token exposes one family's signups, not the program.
- Tokens are revocable and rotate on request (settings → guardian row → "resend links"). URLs never contain student names or PII — just the opaque token.
- **Every generated email footers the same three links:** current itinerary, signup page, "report an absence." Parents learn one pattern: everything is always in the latest email. No app to install, nothing to remember.

Design consequence worth naming: Octv's parent experience is *email plus web pages*, which means deliverability is a first-class concern — verified sending domain on Resend, bounce/unsubscribe webhooks wired to `guardians.email_status`, and a dashboard chip showing "3 bounced emails" so the director fixes bad addresses before comp week.
- **Digest pipeline (Inngest cron, per program, e.g. Sun 6 pm):** gather next 7 days (competitions + published itinerary highlights, general events incl. rehearsal changes, shifts with open slots, alteration deadlines, director notes field) → Claude drafts subject + body → `draft` → director notified → edits/approves → send via Resend to all `guardians` with `email_status='ok'`, each message carrying that family's guardian-token links (§8a), with unsubscribe honored. No approval by Wednesday → reminder, never auto-send.

---

## 9. Cross-feature dependency map (the wiring)

```
students ──▶ ensemble_members(season) ──▶ attendance(competition)
   │                │                          │
   │sizes           │                          ├─▶ meal count form   (headcount: expected − absent)
   ▼                │                          ├─▶ bus manifest      (assignments + absent annotations)
costume_assignments │                          ├─▶ room sheet        (assignments + absent annotations)
   │                │                          └─▶ costume checkout  (greyed when absent)
   ▼                ▼
costume_checkouts(competition)      travel_assignments(trip ⇢ competition)
   ▲                                        ▲
   └── auto-seeded on competition create ───┘ (lazy-seed pattern, idempotent)

itinerary(published) ──▶ parent packet PDF ⟵ pulls: itinerary items + bus groups + room groups
        │                                        + meal info + shift roster (who's working)
        └──▶ shift suggestions (quick-change windows from costume set transitions)

ledger_entries ── optional tags ──▶ competitions / trips ──▶ per-event cost report
events ──▶ digest gathering + dashboard week view;  announcements ──▶ guardians (immediate)
competition_results ──▶ dashboard + archive trophy case
seasons ──▶ everything season-scoped ──▶ archive snapshot + handoff vault (Program tier)
```

**Invariants to enforce (constraint or server action):**
1. Deactivating a student releases costume assignments and travel assignments, and flips attendance to `absent` for future competitions.
2. A competition's ensemble determines every eligibility list (checkouts, attendance, travel queue, quick-change roster). Changing a competition's ensemble after seeding requires a reseed with confirmation.
3. Publishing an itinerary is the gate for: parent visibility, packet generation, shift suggestions.
4. Season archive (setting `archived_at`) makes all season-scoped data read-only via RLS — the handoff vault is literally a frozen season plus exports (CSV of roster/ledger, PDFs of packets).
5. All seeding jobs (checkouts, attendance) are idempotent upserts — safe to re-run when roster changes.

---

## 10. Application architecture

```
app/
  (marketing)/                     # public site
  (app)/[program]/                 # tenant shell — server layout resolves program + membership, injects role
    dashboard/                     # season overview: next comp countdown, alteration queue, open shifts, balance
    roster/                        # students, guardians, ensembles, sizes settings
    costumes/                      # sets, inventory, assignments grid, alterations queue
    competitions/                  # list + [id]/ (itinerary, packet upload+review, attendance, checkout, shifts, results)
    events/                        # rehearsals, fittings, calendar week/month view
    travel/                        # trips + [id]/ (rooms, buses, chaperones, sheets)
    treasury/                      # ledger, budget builder, budget-vs-actual, board snapshot
    comms/                         # announcements (compose + history), digest drafts/review/history
    settings/                      # program, members/roles, guardians directory + CSV import, season rollover, size-field config, feature flags (support-visible)
  (public)/t/[token]/              # tokenized surfaces: itinerary, packet, signup page, absence form — no auth, mobile-first
  api/pdf/[doc]/route.ts           # React-PDF renderers: packet | bus | rooms | board-snapshot (auth-checked, streamed)
  api/inngest/route.ts
```

- **Server components + server actions** throughout; no client state library. Supabase SSR client with RLS as the real gate; server actions re-check role from `program_members` (defense in depth). Token routes use a service-role server context with explicit capability checks per §8a — RLS doesn't apply to anonymous visitors, so the token layer's allowed-action list is the security boundary there and stays deliberately tiny.
- Mobile-first responsive for the three hallway screens (costume checkout, attendance, bus loading) **and all `(public)/t/` pages — those are exclusively phone screens.** Staff desktop-primary elsewhere.
- Inngest functions: `packet/parse`, `digest/draft` (cron), `digest/send`, `announcement/send`, `competition/seed` (checkouts + attendance), `season/rollover-nudge` (spring reminder cron).
- Claude API usage is exactly two prompt families (packet parse, digest draft), both versioned in-repo under `lib/ai/prompts/` with zod schemas beside them. Log token usage per program (cost telemetry from day one).

### Security & testing (non-negotiable for multi-tenant + no-auth tokens)

- **RLS test suite ships with the schema, not after it.** pgTAP (or Vitest integration tests against a local Supabase) seeds two programs and asserts, for every table: program A's staff cannot read/write program B's rows; role write-gates hold (e.g., admin cannot insert `ledger_entries`); archived seasons reject writes. Runs in CI on every migration. A cross-program leak is the existential bug for this product — it gets the same rigor as the money.
- **Token surface hardening:** `(public)/t/` routes are rate-limited (per-IP and per-token, Vercel/Upstash), tokens are ≥128-bit random and hashed at rest, capability checks are an explicit allow-list per §8a, and every token action is logged (`token_events`: token_id, action, ip, at) so a misused link is diagnosable and revocable.
- **Support access, designed not improvised:** `profiles.is_support` (Octv staff only) enables a read-only impersonation view of a program behind an explicit consent flag on the program (`support_access_until` timestamp the director sets). A persistent banner shows "Octv support is viewing as <program>" and all support sessions are logged. Hand-held pilots make this necessary week one; sharing passwords is the alternative and it's disqualifying.
- Sentry (or equivalent) on both app and Inngest functions; email send failures surface on the dashboard, not just in logs.

## 11. Build sequencing (one platform, one launch)

**Philosophy: build everything, stage nothing.** The platform below is the functional whole — there is no "phase 2 of the MVP." The sequence exists only because a solo build has to type things in *some* order, and dependency order (foundation → roster → domains → comms) is the only order that compiles. Nothing ships to a pilot until the whole platform stands; feature flags (§13) then control per-program exposure as individual features harden.

| Seq | Build | Depends on |
|---|---|---|
| 1 | Tenancy, timezone, auth (staff+board), memberships/5 roles, RLS **+ RLS test suite**, feature-flag plumbing, settings | — |
| 2 | Roster: students (minimal fields), guardians, ensembles, combined CSV import (preview/commit + health-column skip), size-field config | 1 |
| 3 | Costume/inventory system: pieces (incl. props/sets), sets, assignment grid, alterations queue, checkout | 2 |
| 4 | Competitions + attendance + results; events; manual itinerary editor; packet parse pipeline + review UI | 2 |
| 5 | Trips, rooms/buses, chaperones; all React-PDF outputs (packet, bus, rooms, board snapshot) | 3, 4 |
| 6 | Treasury: budget builder, ledger + void/audit, budget-vs-actual, per-event cost report | 1 |
| 7 | Comms: announcements, shifts + AI suggestions, digest pipeline, full tokenized link layer (§8a), deliverability wiring | 2, 4 |
| 8 | Dashboard, season rollover + archive read-only, trophy case, export-all, support access, seed/demo data, Sentry | all |

Solo estimate: **7–8 weeks** to complete platform (the added scope — announcements, events, results, imports, flags, test suite — buys back most of what dropping payments saved, and that's the right trade).

Demo script for director outreach is unchanged and available once seq 5 stands internally: upload a real host packet → published itinerary → generated parent packet with their actual bus and room lists. Ninety seconds.

## 12. Feature flags (release control, not build control)

```sql
-- Flag registry lives in code (typed): lib/flags.ts defines keys, descriptions, default state.
-- programs.feature_overrides jsonb holds per-program overrides: {"digest": true, "packet_parse": false}
```

- **Evaluation:** one server-side helper `flag(program, key)` = override ?? code default. Resolved once in the tenant layout, passed via context; Inngest jobs check the same helper before running (a program with `digest` off gets no Sunday cron).
- **Gating surface:** navigation items hide, routes 404 (server-side check, not CSS), and Inngest jobs no-op. No client-side-only gating anywhere.
- **Flags are for rollout and pilot pacing** ("turn on packet parsing for Homewood this week"), kill switches (AI features can be disabled globally in minutes), and tier mapping (Prep/Varsity/Program tiers are themselves expressed as flag bundles — one mechanism, not two).
- No third-party flag service — a jsonb column and a typed registry is the whole system. Support (§10) can toggle per-program flags from the settings surface.

## 13. Pre-launch checklist (tracked now, blocking before GA)

1. **Privacy & legal pack — light because the data is light:** privacy policy + ToS stating the precise posture: Octv holds minimal, directory-tier PII (student names, grad years, sizes, attendance; adult contact info) and **no sensitive categories** — no health, medical, emergency, birthdate, address, photo, or biometric data, and no student accounts, by architecture. Never claim "no PII" anywhere — a savvy board member will catch the overclaim. Include a one-page data summary a booster board can read in a meeting, commitments to no data sale, real export/deletion, and breach notification. State student-privacy statutes in pilot states get a sanity check, and a one-hour attorney review of the policy before GA is cheap insurance. Free-text fields (notes, memos) carry a standing "no health or medical information" label.
2. **Export-all is a real button:** program-level "export everything" (roster/guardians/ledger CSVs + every generated PDF, one zip, async job + email link). This is the anti-lock-in trust answer every burned Charms customer will ask for, and it doubles as the handoff vault's escape hatch.
3. **Deletion story:** program deletion = 30-day soft window, then hard purge including Storage objects and tokens; documented in the privacy policy.
4. **Octv's own billing:** Stripe Billing for Octv subscriptions ($349/$749, annual) — the platform's revenue rail, unrelated to booster money which Octv never touches. Free-pilot programs run on a `pilot` flag bundle; Stripe integration can be the last thing built before public GA without touching the domain schema.
5. **Deliverability runway:** verified sending domain, DMARC/SPF/DKIM, warm-up sends before the first program's digest, bounce webhook wiring verified end-to-end.
6. **Name & domain decision:** octv.com and octv.app are taken — the product will be renamed before launch (TBD). "Octv" is a working codename only. **The codebase must be name-agnostic:** all branding (product name, domain, support email, PDF footer, email from-name) flows from a single `lib/brand.ts` config + env vars; no hardcoded product name anywhere in UI, PDFs, emails, or metadata. Renaming must be a one-file change plus DNS. Blocks outreach emails and deliverability setup, not the build.

## 14. Open decisions (flagging, with recommendations)

1. **Family portal (parent or student logins):** firmly out by design — the tokenized layer is the family surface. If pilots later demand richer family interaction (payment plans would force it), accounts can be added without schema change: `guardians` gains back a nullable `user_id` and tokens keep working for everyone else. The door stays open; nothing walks through it in v1.
2. **Multi-ensemble competitions** (varsity + prep at same comp): modeled as two `competitions` rows sharing date/venue. A `competition_group` wrapper is a clean later add; don't pre-build.
3. **Email-forward ingestion** (director forwards packet email to `packets@octv…`): now in scope per build-complete — Resend inbound routes into the same `documents` → parse pipeline, built in seq 7 with the deliverability wiring. It's the single most magical onboarding moment for a director.
4. **Sizes schema per program** is a settings screen in seq 2 — hardcoded size fields will be wrong for someone's program immediately.
