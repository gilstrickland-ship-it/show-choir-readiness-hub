# Simplicity Review — July 2026

A structural UX review of every feature in the Season OS platform, with one question: **where does the product make a non-technical director or booster parent work harder than they should?** The July 2026 product review (docs/product-review-2026-07.md) fixed vocabulary, bugs, and the parent notification layer; this review goes after the *structure* — how many places, pages, fields, and decisions each job takes — and rebuilds toward "super easy without losing required capability."

Conducted July 27, 2026. Research + design: Fable 5. Implementation: Opus 5 agents against spec-kit tasks in `specs/005-simplicity-rebuild/`.

---

## 1. Research: how complex SaaS stays simple

Principles drawn from published UX research and from products that serve the same kind of user (volunteer-run teams, non-technical admins), each mapped to what it means for this platform.

**P1 — Progressive disclosure, two levels max.** Show the minimum a user needs for the next decision; reveal the rest on request. NN/g's original guidance: it improves learnability, efficiency, and error rate — and *two* levels serve almost every design; each extra level multiplies clicks and halves discoverability. What belongs at level 1 is decided by task frequency, not by data model shape. ([NN/g](https://www.nngroup.com/videos/progressive-disclosure/), [UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/))
→ *Here:* create forms ask name + date; host school, venue address, URLs, repeat rules, audience targeting live behind one "more" layer (the detail page or a disclosure), never a third.

**P2 — Opinionated defaults over configuration.** Linear's method: "one really good way of doing things"; universal terminology over specialized jargon; "reduce the amount of fiddling around with processes." Strong opinions at the atom level (what a competition *is*), flexibility only where organizational diversity demands it (how many ensembles attend). ([Figma blog — The Linear Method](https://www.figma.com/blog/the-linear-method-opinionated-software/))
→ *Here:* status defaults to Planned, an only-ensemble is auto-selected, events default to whole-program, a trip attached to a comp inherits its name and dates. The user overrides; the product never interrogates.

**P3 — Minimal create, gather later.** Form research is unanimous: ask only what's essential to create the record — remove any field whose absence doesn't break functionality, and collect the rest incrementally. ([Designpixil](https://designpixil.com/blog/saas-form-design-best-practices), [Tiller](https://tillerdigital.com/blog/web-form-optimization-best-practices-for-b2b-saas/))
→ *Here:* the 8-field competition form and 9-field event form become 2–3 field quick-adds; everything else is editable where the record lives.

**P4 — The doing happens where the looking happens.** TeamSnap's enduring appeal to volunteer users is "all team information, schedules, and messaging in one place" — a season is *one surface*, viewed and managed in the same spot. ([TeamSnap](https://www.teamsnap.com/teams)) Google Calendar's quick-create is the canonical pattern: a small popover with title + time, "More options" for the full editor.
→ *Here:* the Season spine is where directors look; add and edit must happen there, not on satellite module pages reached by anchor links.

**P5 — Empty states and first-runs sell the next action, not the feature list.** Setup checklists tied to a concrete outcome ("get your first deal in the pipeline", not "explore the CRM") measurably raise completion; empty states should carry the single next action. ([ProductLed](https://productled.com/blog/5-best-practices-for-better-saas-user-onboarding), [Appcues](https://www.appcues.com/blog/saas-user-onboarding))
→ *Here:* the Journey panel (spec 003) already does this well. The remaining gap: dead-end empty states ("create an ensemble first") and lifecycle actions buried in Settings ("start a season" living inside a *rollover* wizard).

**P6 — One list, one truth.** Duplicated views of the same records (a Season spine *and* three module list pages) mean two places to check and a navigation decision on every visit. Vestigial surfaces are complexity even when each one is individually clean.
→ *Here:* module pages either earn their keep with a distinct job (the events month/week calendar, the absence queue) or stop being destinations.

---

## 2. Method

- First-hand deep read of the season-management cluster (Season spine, Competitions, Events, Travel, Rollover, Today) — the feature the review starts with.
- Full-app feature inventory: every route under `app/(app)/[program]`, `app/launch`, `app/invite`, and the parent token surface — page size, form count, role/flag gates, navigation distance for common jobs (§4).
- Grounding in the repo's own prior research (`docs/research/`, `docs/product-review-2026-07.md`) — user problems and vocabulary are already validated; this review does not re-litigate them.
- Constitution constraints respected throughout: RLS isolation, directory-tier PII, AI-drafts-only, tokenized parent links, flag gating, void-only money. Simplification never removes an enforced guarantee.

## 3. The season manager, diagnosed

The Season page (`app/(app)/[program]/season/page.tsx`) is a good *view* — one chronological spine, month-grouped, with a featured next-comp row. The complexity is that **managing** the season happens everywhere except there:

| Job | Today's path | Cost |
|---|---|---|
| Add a competition | Season → "+ Competition" → `/competitions#add` → 8-field form under a table → redirected to the module list, not back | 2 pages, 8 fields, 2 paragraphs of policy prose, wrong landing |
| Add an event | Season → `/events#add` → 9-field form under a calendar grid | Same pattern; "Repeat weekly ×" and audience checkboxes always visible |
| Add a trip | Season → `/travel#add`, or the per-comp suggestion rows on `/travel` | The good idea (comp-linked prefill) lives on the page directors least visit |
| Fix a date/name | Navigate into each record's detail page | A popover-sized edit costs a full page round-trip |
| Start the first season | Today/Season alert → Settings → **Rollover** → 6-step wizard | A first-run action gated behind year-over-year machinery, with steps like "Re-point costume sets" |
| Subscribe to the calendar feed | A ~60-line always-open box mid-Season-page | Every visit pays the visual cost of a one-time setup action |

None of this is required by the data model. The platform already owns the right pattern — the `.drawer` quick-add (`<details>` popover, server-first, no client JS) used on People and Money — and the season cluster simply never adopted it.

## 4. Full-feature inventory (route-by-route audit)

Scale: 46 staff pages (~23,000 LOC) + 6 parent routes (~2,300 LOC); 34 `actions.ts` modules exposing 151 server actions. Three client components in the entire staff app — the server-first architecture is a genuine strength and every wave preserves it.

### What's healthy (keep, and copy from)

- **The parent surface (2/5 complexity)** — one poster page, four footer links, zero jargon. The model for everything else.
- **Today** — action-driven hub; complexity is all in assembly, not in the user's face.
- **The architecture**: `getTenantContext` one-stop resolution, defense-in-depth role gates, role-hidden `<Restricted>` vs flag-hidden 404 distinction, spec-traceable header comments, brand indirection, human-approval invariant.

### Complexity hotspots (ranked, top tier)

1. **`travel/[tripId]` — 1,368 LOC, 11 forms, 59 inputs.** Two *competing* assignment models live simultaneously (two-pane `?sel=` select-then-assign, and the `?fill=` tap-chip queue) plus trip edit/delete, chaperones, group CRUD, capacity meters, conflict banners.
2. **`competitions/[id]` — 1,004 LOC, 5 forms.** A command center that re-implements light versions of 4 child routes' editing while those routes still exist; the ensemble-change confirm replays the whole record through 9 hidden inputs.
3. **`hosting/[eventId]` — 948 LOC, 9 forms, 6 disclosures.** Every mutation hidden behind an unlabeled-contents `<details>` triangle.
4. **`treasury` — 892 LOC.** Add-entry = 9 fields including *three* separate categorization selects (budget line / competition tag / trip tag); 8-control filter row; "Correct → void & re-enter → Save re-entry" vocabulary.
5. **`season` — 751 LOC read-only page whose three primary CTAs all leave the page** (Wave 1 fixes this).
6. **Itinerary editor (593) / budget builder (576, 9 forms) / rollover wizard (517, 6 steps, no progress indicator, inconsistent step numbering) / shifts (489, a third inline-edit convention) / comms landing (449, digest state machine duplicated with `/comms/digest`) / student detail (553, 9 forms, 5 verbs per guardian row).**
7. **The packet→itinerary pipeline**: six user decisions across three routes to get times in front of parents, with status only as chips.

### Cross-cutting patterns (the systemic simplification)

- **Navigation**: mobile tab slots are hardcoded (Today/Season/People/Wardrobe) and don't backfill by role — a **treasurer's only job (Money) sits inside "More"**; board members get the same treatment. The Competitions list has no nav entry at all; `/competitions`, `/events`, `/travel`, `/history` fell out of nav in the season redesign but remain the only home of their create forms.
- **Three competing inline-edit conventions** (`<details>` edit, `?edit=` mode switch, always-rendered anchored sections) where one should exist.
- **Six near-identical tab-strip components** across two different CSS classes.
- **The share-link mint/regenerate block duplicated ~verbatim three times** (~40 LOC each).
- **Flash-message spaghetti**: every page hand-rolls an `ERR` map plus chains of `{sp.x && <p className="alert-ok">…}` (10 conditionals on shifts alone; hosting declares 8 searchParams that exist only as toasts).
- **Dead config**: `announcements` and `support_access` flags are never evaluated; the `program` tier is byte-identical to `varsity`; `/costumes/alterations` is a 22-line redirect stub; `TIMEZONES` is copy-pasted in two files.
- **Jargon without teaching**: "Reseed attendance", "Re-enter (from voided entry)", "Broadcast signup link", "quick change" grids that never explain their model.
- The IntroStrip guidance system is bolted onto **exactly the eight screens that are too complex to use unaided** — the guidance list *is* the hotspot list. Guidance is a symptom; the rebuild treats causes.

## 5. The rebuild — wave plan

Each wave lands independently on the existing flags, passes the full gate (typecheck · unit · RLS · build · e2e reconciliation), and removes no enforced capability. Waves in value order:

| Wave | Target | Core moves |
|---|---|---|
| **1. Season manager** | season cluster + first-run | One `+ Add` drawer on the spine (P4); minimal creates with smart defaults (P2/P3); row edit popovers; one-submit first-season start; calendar box → one line. *(spec'd; in implementation)* |
| **2. Trip planning** | `travel/[tripId]` | One assignment model (the tap-to-fill queue — phone-first and simpler) absorbs the two-pane model; page restructured into visible sections; group/chaperone edits consistent with the app-wide edit idiom. |
| **3. Comp week** | `competitions/[id]` + pipeline | Command center becomes a true hub: readiness + status glances + links; stops duplicating child-route editing; ensemble-change confirm simplified; packet pipeline gets a visible step indicator ("Uploaded → Parsed → Reviewed → On itinerary → Published"). |
| **4. Money** | treasury + budget | Add-entry: 4 essential fields, one "connect it to…" disclosure for the three tags (P1); filter row collapses; plain-language correction flow; budget builder's per-level forms consolidated. |
| **5. Comms** | `/comms` + digest + shifts | One digest surface (landing absorbs the workspace or vice versa); shifts adopt the standard edit idiom; `announcements` flag wired or removed. |
| **6. People** | student detail + guardians | Guardian row: 5 verbs → 2 (Edit, Send links) with the rest inside; the three near-synonym send actions unified; email-issues page gains its fix-in-place. |
| **7. Hosting** | `hosting/[eventId]` | Blind disclosures → visible sections with summaries; consistent edit idiom; schedule generation as a clear primary action. |
| **8. System pass** | cross-cutting | Role-aware mobile tab backfill; one shared SubTabs; one shared ShareLinkCard; one flash-message convention; dead flags/tier/stub/duplicate-array cleanup; quick-change explainer. |
| **9. Tutorials & first-use** *(last, by design)* | guide system (spec 003) | Journeys re-derived from the rebuilt flows; every IntroStrip re-justified against its simplified surface (rewritten, shortened, or removed); parent welcome reviewed. Runs after Waves 1–8 so guidance describes the product that actually shipped. |

Waves 2–8 are specified in `specs/005-simplicity-rebuild/spec.md` as they enter implementation; the inventory above is their factual base.
