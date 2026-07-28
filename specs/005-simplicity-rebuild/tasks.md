# Tasks: Simplicity Rebuild

**Spec**: `spec.md` · **Plan**: `plan.md` · Numbering continues from 004 (last: T114).

## Phase 1 — Wave 1: Season manager

- [X] T120 Season quick-add drawer (US1): one `+ Add` drawer on `season/page.tsx` with per-kind sections (flag+role gated as today); competition/event/trip minimal forms per plan §A (smart defaults, sub-disclosures, ensemble auto-attach when single, "More options →" to module `#add` forms); `from=season` allow-listed return-path threading through `createCompetition`/`createEvent`/`createTrip` redirects (module-page flows unchanged); `createTrip` inherits name/dates from linked comp server-side (travel-page suggestion rows switch to the same path); error-reopen drawer state; ensembles-empty guidance message.
- [X] T121 Spine row edit popovers (US2): per-row Edit `<details>` popover for comp (name/date/status → `updateCompetition`), event (title/starts/location → `updateEvent`), trip (name/dates/overnight → `updateTrip`, room-safety guard intact); writer-roles only; hosting rows untouched; `from=season` on the three update actions; no per-row queries added (add `location` to the season events select); mobile-safe popover anchoring.
- [X] T122 Start-season card (US3): `StartSeasonCard` + one-submit create-and-activate action (factored from rollover actions), season-label smart default helper (unit-tested), zero-seasons detection on Today + Season, non-settings informational variant, seasons-exist-none-active fallback to today's alert; rollover wizard drops first-season branching + plain-language pass ("Copy costume set names…"); journey-panel step target + e2e contract reconciled in the same change.
- [X] T123 Calendar subscribe → one-line disclosure (US4): collapsed `<details>` on Season, auto-open on `?calShare=`/`?calError=`, contents and privacy flow unchanged.
- [X] T124 Wave-1 verification: full gate (`typecheck` · `test:unit` · `test:rls` via embedded PG · `build`); `tests/e2e` statically reconciled + `npx playwright test --list --config playwright.config.e2e.ts` passes; visual QA screenshots (drawer open/closed, edit popovers, start-card, collapsed subscribe line; 375px pass) + rendered-contrast check on changed surfaces.

## Phase 2 — Wave 2: Trip planning

- [X] T125 One assignment model (US5): remove `?sel=` select-then-place from `travel/[tripId]` (links, selected-state UI, per-group "Assign here"); fill-target flow (`?fill=`, sticky bar, chip queue) becomes the sole path; unassigned list becomes read-only status; e2e specs exercising `?sel=` rewritten to fill-flow parity.
- [X] T126 Scannable trip page (US6): constant section order (Overview · Schedule · Buses · Rooms · Chaperones · Papers · Danger zone), live-summary `<summary>` lines on every disclosure, edit-trip popover summary, section-local error rendering, delete under Danger zone.
- [X] T127 Wave-2 verification: full gate + e2e listing + visual QA (fill flow on 375px, section summaries, contrast).

## Phase 2b — Wave S: Tenant-isolation remediation (SECURITY, user-authorized schema exception)

- [X] T148 Action hardening app-wide (S-3/S-4/S-5): travel (resolveTrip/resolveGroup resolvers, eligibility re-derived, chaperone name cap, scoped+checked deletes), roster/comms/tokens (share_links verified in-program at mint AND resolve, shift_signups, guardian_tokens, ensemble_members), competitions/events/hosting/costumes/treasury (packet+documents read scoping, ledger tag FKs, budget hierarchy, attendance/results/junctions, hosted_slots, costume assignments); `lib/pdf/queries.ts` + `lib/export-run.ts` program-scoped; friendly errors for DB FK rejections.
- [X] T149 Migration `0017_tenant_fk_integrity.sql` (S-1/S-2): composite `(id, program_id)` FKs across all vulnerable children with ON DELETE semantics preserved, `enforce_one_group_per_kind_per_trip` → SECURITY DEFINER + cross-program assertion, other triggers swept; fail-loud-never-delete guard + read-only pre-flight script.
- [X] T150 RLS poisoning suite (S-6): per-table cross-tenant insert attempts asserted rejected; same-program one-room-one-bus regression; harness enumeration extended so new tables are swept automatically.
- [X] T151 Production deploy (S-7): apply `0016_multi_ensemble` (merged, required by deployed code, never applied — competitions render with no ensembles today) then `0017`; operator-run `supabase db push` (Claude is blocked from DDL here). Pre-flight already clean.

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
- [ ] T143a Slug-redirect hardening (Wave-1 review follow-up): every module-page `fail()`/redirect that interpolates the form's `slug` goes through the fail-closed `returnPath`/`programPath` guard (protocol-relative open-redirect class fixed app-wide, F6 pattern); rollover page `ERR[sp.error]` gets the Object.hasOwn + array-typed-param guards like the season page.
- [ ] T144 Wave-8 verification: full gate + e2e + visual QA (per-role mobile nav screenshots).

## Phase 9 — Wave 9: Tutorials & first-use refresh (runs LAST, after Waves 1–8)

- [ ] T145 Journey re-derivation (US12): all role journeys in `lib/guide.ts` re-pointed at rebuilt flows (steps, links, labels, verifiers); non-director journeys reflect rebuilt surfaces + Wave-8 mobile nav; e2e guide contracts updated coherently.
- [ ] T146 Strip re-justification (US12-2): each of the eight IntroStrips rewritten for the new UI, shortened, or removed where the rebuilt surface self-explains; `?help=1` + Got-it semantics preserved for survivors; parent welcome card reviewed.
- [ ] T147 Wave-9 verification: full gate + e2e + visual QA (fresh-program walkthrough per role, journey panel states, surviving strips).
