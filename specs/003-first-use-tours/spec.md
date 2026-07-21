# First-Use Tours ("Guide") — Feature Spec

Role-shaped first-use guidance that steps new users through the tool, completes itself from real data, never nags returning users, and can be re-triggered on demand. Designed with the product owner (three decisions locked: journeys run through first parent contact; intro strips on complex screens only; parents get one welcome card).

Constitution checkpoints: server components + server actions only ('use client' only if a form genuinely needs it — none anticipated); flag-gated exposure (`guide`, default true, no tier bundle — core UX, kill-switch only); no third-party tour library; brand via lib/brand.ts; program_members jsonb state (per-person per-program); parents stay account-less (their card derives from token_events, zero schema).

## 1. State model

Migration 0014: `program_members.guide_state jsonb not null default '{}'`.
Shape (all keys optional):
```
{ "journey_dismissed": true,          // hides the journey panel
  "strips": { "<surfaceKey>": true }  // intro strip collapsed for this surface
}
```
- Writes go through server actions using the service-role client with an explicit check that the session user owns the membership row (program_members self-update isn't RLS-permitted; the action is the guarded path — defense in depth, same idiom as token routes).
- No completion timestamps stored: step completion is ALWAYS derived from live data at render (idempotent, device-independent, survives re-roling — a member re-roled treasurer sees the treasurer journey fresh, correctly).
- RLS: no new policies (column rides existing program_members policies; writes bypass via the guarded action).

## 2. Journey panel (Today page, replaces/absorbs the Wave-D setup guide)

One panel component, role-switched. Rendering states:
- **Active** (≥1 step incomplete, not dismissed): full checklist, same visual idiom as the current setup guide (numbered rows, ✓ done state, role-gated links).
- **Pill** (≥1 complete AND ≥1 incomplete AND panel previously seen... simplification: full panel while <2 steps complete; pill otherwise): slim single-row progress ("Getting started · 4 of 7 · Continue") expanding via link back to full panel (querystring `?guide=open`).
- **Gone**: all steps complete OR journey_dismissed. A quiet "Getting started" reopen link lives in the mobile More sheet + desktop header account cluster (flips journey_dismissed=false via action, redirects to Today).
- Dismiss affordance on the panel: "Hide this guide" (linklike, small) → journey_dismissed=true.

The existing first-run setup guide on Today is REPLACED by the director/admin journey (its four steps are the journey's first four; keep its lean-query short-circuits: skip all checks when the final step's data exists). Preserve the e2e assertions contract: tests/e2e/onboarding.spec.ts asserts heading "Set up your program" + link "Start your season" — keep those exact strings as the director-journey panel heading/step-1 label so the spec keeps passing, or update the spec in the same change.

### Step definitions (auto-verified; each row: label · verifier · link)
**Director / admin** (heading "Set up your program"):
1. Start your season · active season exists · settings/rollover
2. Add your students · students(status=active) > 0 · roster/import (hint: "import a spreadsheet, or add them one at a time")
3. Put students in an ensemble · ensemble_members for active season > 0 · roster/ensembles
4. Add your first competition · competitions this season > 0 · competitions
5. Publish the itinerary · itineraries status=published this season > 0 · competitions (link to next comp's itinerary when one exists)
6. Email families their links · guardian_tokens for program > 0 · roster (hint: "Email links to all families" — one click)
7. Send your first announcement · announcements status=sent > 0 (OR digests status=sent > 0) · comms/announcements
Queries are lean-by-construction: run only while the panel could render (skip everything when step 7's verifier passes or dismissed).

**Treasurer** (heading "Set up the books" — requires treasury flag; if flag off, no panel):
1. Open a budget from a template · active budget exists · treasury/budget
2. Record your first entry · non-voided ledger_entries > 0 · treasury
3. Attach a receipt · ledger entry with receipt_path exists · treasury
4. Mark a month reconciled · ledger_reconciliations > 0 · treasury
Footer pointer (not a step): "Before your next board meeting: download the board snapshot." → treasury/reports.

**Costume manager** (heading "Set up the wardrobe" — costumes flag):
1. Add your pieces · costume_pieces > 0 · costumes/inventory
2. Group them into a set · costume_sets this season > 0 · costumes/sets
3. Assign pieces to students · costume_assignments this season > 0 · costumes/assignments
4. Work the alterations queue · any assignment alteration_status ∈ (in_progress, done) · costumes (landing)
5. Run checkout on comp day · any costume_checkouts.checked_out_at not null · costumes/checkout

**Board member** (heading "Where everything lives" — orientation card, not tasks): four link rows (Money → full ledger; Budget vs actual; Reports & board snapshot; Season calendar) + one sentence: "Your seat sees everything and changes nothing — that transparency protects the program." Single "Got it" dismiss (journey_dismissed).

Role changes: guide_state persists but journeys derive from CURRENT role — a re-roled member sees the new role's journey unless dismissed (dismissal is per-membership, acceptable).

## 3. Intro strips (complex surfaces only)

Surface keys (exactly these eight): `treasury`, `budget`, `itinerary_editor`, `packet_review`, `trip`, `hosting_event`, `import`, `digest`.
- Placement: directly under the page heading. Copy: ≤2 sentences of "what this is" + one bolded "First:" action. Voice: plain, warm, zero jargon. Each strip's copy is part of this spec's implementation (writer drafts, reviewer holds the bar).
- Shown when: guide flag on AND !guide_state.strips[key] — OR `?help=1` regardless of state (the re-trigger).
- Dismiss: "Got it" button → server action sets strips[key]=true → redirect back (no querystring residue).
- Re-trigger: a small "?" affordance beside the page heading on those eight pages linking `?help=1` (title="What is this page?"). Rendering with ?help=1 does NOT clear the stored state.
- Strip content must not duplicate an adjacent empty-state; where an empty state already explains the surface (e.g. budget page's "No budget yet" template offer), the strip focuses on orientation ("Money in, money out, nothing deleted — corrections are voided and re-entered so the books always audit clean.").

Example copy (final wording at implementer's discretion within this voice):
- treasury: "Every dollar in or out gets one line here — nothing is ever deleted, corrections are voided and re-entered, and the whole board can see the books. **First: add today's most recent transaction.**"
- itinerary_editor: "This schedule is the single source families see — publish once, then keep it current; changes reach their phones instantly. **First: add the call time.**"
- import: "Bring the spreadsheet you already have — Charms and CutTime exports work as-is, and health or medical columns are refused automatically. **First: choose your file and preview before anything saves.**"

## 4. Parent welcome card (token surface)

- On the family hub (guardian tokens only, not share links): render a welcome card when the guardian's total `token_events` view count (across their tokens) is ≤ 2 at render time (count BEFORE this visit's log write, or ≤3 after — implementer picks one consistently). Card auto-fades with use; no dismissal storage, no schema, no client state.
- Copy (3 lines): "This page is your family's — bookmark it, it works all season." / what the three links do (see times · sign up to help · report an absence) / "Everything also arrives by email. The links in your newest email always work."
- Footer of every token page gains a quiet "How this page works" link → hub with `?welcome=1` which force-shows the card (read-only; no new capability — presentational).

## 5. Flag + reopen affordances

- lib/flags.ts: `guide` (description "First-use guidance: role journeys, screen intros, parent welcome card.", default true). Not in tier bundles. When off: no panel, no strips, no "?", no parent card, reopen links hidden.
- Reopen: "Getting started" link in MobileNav's More sheet and in the desktop header account cluster (visible whenever flag on; if journey complete it still opens the panel in its all-✓ state so users can revisit links).

## 6. Tasks (Phase 12)

- T057 Guide foundation: migration 0014 guide_state, `guide` flag, lib/guide.ts (journey definitions + verifiers + strip registry + guarded state actions), unit tests for pure pieces.
- T058 Journey panel on Today for all four role shapes (absorbing the setup guide, preserving/updating e2e contract), reopen affordances.
- T059 Intro strips on the eight surfaces + "?" re-triggers.
- T060 Parent welcome card + footer link; e2e reconciliation pass; RLS suite green with 0014.

Verification gate per change: typecheck · test:unit · test:rls · build; e2e statically reconciled.
