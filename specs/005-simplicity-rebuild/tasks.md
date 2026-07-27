# Tasks: Simplicity Rebuild

**Spec**: `spec.md` · **Plan**: `plan.md` · Numbering continues from 004 (last: T114).

## Phase 1 — Wave 1: Season manager

- [ ] T120 Season quick-add drawer (US1): one `+ Add` drawer on `season/page.tsx` with per-kind sections (flag+role gated as today); competition/event/trip minimal forms per plan §A (smart defaults, sub-disclosures, ensemble auto-attach when single, "More options →" to module `#add` forms); `from=season` allow-listed return-path threading through `createCompetition`/`createEvent`/`createTrip` redirects (module-page flows unchanged); `createTrip` inherits name/dates from linked comp server-side (travel-page suggestion rows switch to the same path); error-reopen drawer state; ensembles-empty guidance message.
- [ ] T121 Spine row edit popovers (US2): per-row Edit `<details>` popover for comp (name/date/status → `updateCompetition`), event (title/starts/location → `updateEvent`), trip (name/dates/overnight → `updateTrip`, room-safety guard intact); writer-roles only; hosting rows untouched; `from=season` on the three update actions; no per-row queries added (add `location` to the season events select); mobile-safe popover anchoring.
- [ ] T122 Start-season card (US3): `StartSeasonCard` + one-submit create-and-activate action (factored from rollover actions), season-label smart default helper (unit-tested), zero-seasons detection on Today + Season, non-settings informational variant, seasons-exist-none-active fallback to today's alert; rollover wizard drops first-season branching + plain-language pass ("Copy costume set names…"); journey-panel step target + e2e contract reconciled in the same change.
- [ ] T123 Calendar subscribe → one-line disclosure (US4): collapsed `<details>` on Season, auto-open on `?calShare=`/`?calError=`, contents and privacy flow unchanged.
- [ ] T124 Wave-1 verification: full gate (`typecheck` · `test:unit` · `test:rls` via embedded PG · `build`); `tests/e2e` statically reconciled + `npx playwright test --list --config playwright.config.e2e.ts` passes; visual QA screenshots (drawer open/closed, edit popovers, start-card, collapsed subscribe line; 375px pass) + rendered-contrast check on changed surfaces.

## Phase 2 — Wave 2: Trip planning

- [ ] T125 One assignment model (US5): remove `?sel=` select-then-place from `travel/[tripId]` (links, selected-state UI, per-group "Assign here"); fill-target flow (`?fill=`, sticky bar, chip queue) becomes the sole path; unassigned list becomes read-only status; e2e specs exercising `?sel=` rewritten to fill-flow parity.
- [ ] T126 Scannable trip page (US6): constant section order (Overview · Schedule · Buses · Rooms · Chaperones · Papers · Danger zone), live-summary `<summary>` lines on every disclosure, edit-trip popover summary, section-local error rendering, delete under Danger zone.
- [ ] T127 Wave-2 verification: full gate + e2e listing + visual QA (fill flow on 375px, section summaries, contrast).

## Phase 3 — Wave 3: Comp week

- [ ] T128 Hub de-duplication (US7): comp page → header + readiness rail + per-area glance cards (status sourced from existing readiness queries); remove hub-inline attendance grid + duplicated itinerary/meals editing; keep Results/Edit-details/ensembles with standard idiom; ensemble-change confirm slimmed to id + new ensemble ids + confirm flag (server re-reads state).
- [ ] T129 Packet pipeline step indicator (US7-4): shared 5-step component (Uploaded → Parsed → Reviewed → On itinerary → Published) on packet/review/itinerary pages, rendered from existing statuses; no behavior change.
- [ ] T130 Wave-3 verification: full gate + e2e + visual QA.

## Phase 4 — Wave 4: Money

- [ ] T131 Four-decision add-entry + plain-language corrections (US8-1/2): drawer → direction/amount/who/memo + one "Connect it" disclosure (3 tags + receipt); correction vocabulary ("Fix this entry" / "Void it" / "Void & redo"); ledger semantics untouched.
- [ ] T132 Filter + budget forms (US8-3/4): filter row → search + 2 selects + "More filters" disclosure; budget "Add line" and "Category settings" separated; standard edit idiom on lines.
- [ ] T133 Wave-4 verification: full gate + e2e + visual QA.

## Phase 5 — Wave 5: Comms

- [ ] T134 One digest home (US9-1/2): landing card → status + link only; workspace owns all digest actions; digest-off behavior preserved.
- [ ] T135 Shifts standard edit + announcements flag wired (US9-3/4): `?edit=` mode → per-row edit popovers; `/comms/announcements` requires `announcements` flag (default stays on).
- [ ] T136 Wave-5 verification: full gate + e2e + visual QA.

## Phase 6 — Wave 6: People

- [ ] T137 Guardian row (US10): two affordances (Send family links · Edit popover with update/reset/remove); merge near-synonym send actions into one canonical action; email-issues rows link to the in-place fix; student page grouped Profile · Sizes · Guardians · Status.
- [ ] T138 Wave-6 verification: full gate + e2e + visual QA.

## Phase 7 — Wave 7: Hosting

- [ ] T139 Visible host command center (US11): schools + schedule as visible tables; mutations in labeled disclosures with live-count summaries; generate-schedule as primary; toast searchParams collapsed.
- [ ] T140 Wave-7 verification: full gate + e2e + visual QA.

## Phase 8 — Wave 8: System pass

- [ ] T141 Role-aware mobile tabs: `MobileNav` backfills tab slots from the viewer's visible nav items (ordered preference), More sheet holds the rest.
- [ ] T142 Shared components: one SubTabs (six copies retired, one visual class), one ShareLinkCard (three duplicated blocks retired), `<Flash>` helper adopted on hotspot pages (shifts, hosting, trip, treasury).
- [ ] T143 Dead-weight cleanup: `support_access` flag removed from registry (real gate documented), `/costumes/alterations` stub deleted (backTarget default corrected), single `TIMEZONES` source, quick-change explainer sentence.
- [ ] T144 Wave-8 verification: full gate + e2e + visual QA (per-role mobile nav screenshots).
