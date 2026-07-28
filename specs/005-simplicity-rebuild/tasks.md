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

- [X] T128 Hub de-duplication (US7): comp page → header + readiness rail + per-area glance cards (status sourced from existing readiness queries); remove hub-inline attendance grid + duplicated itinerary/meals editing; keep Results/Edit-details/ensembles with standard idiom; ensemble-change confirm slimmed to id + new ensemble ids + confirm flag (server re-reads state).
- [X] T129 Packet pipeline step indicator (US7-4): shared 5-step component (Uploaded → Parsed → Reviewed → On itinerary → Published) on packet/review/itinerary pages, rendered from existing statuses; no behavior change.
- [X] T130 Wave-3 verification: full gate + e2e + visual QA.

## Phase 4 — Wave 4: Money

- [X] T131 Four-decision add-entry + plain-language corrections (US8-1/2): drawer → direction/amount/who/memo + one "Connect it" disclosure (3 tags + receipt); correction vocabulary ("Fix this entry" / "Void it" / "Void & redo"); ledger semantics untouched.
- [X] T132 Filter + budget forms (US8-3/4): filter row → search + 2 selects + "More filters" disclosure; budget "Add line" and "Category settings" separated; standard edit idiom on lines.
- [X] T133 Wave-4 verification: full gate + e2e + visual QA.

## Phase 5 — Wave 5: Comms

- [X] T134 One digest home (US9-1/2): landing card → status + link only; workspace owns all digest actions; digest-off behavior preserved.
- [X] T135 Shifts standard edit + announcements flag wired (US9-3/4): `?edit=` mode → per-row edit popovers; `/comms/announcements` requires `announcements` flag (default stays on).
- [X] T136 Wave-5 verification: full gate + e2e + visual QA.

## Phase 5b — Wave W: Wardrobe (costume manager) — runs after Wave 5

- [X] T152 Four tabs, not six (US13): tab strip → Inventory · Assignments · Alterations · Checkout; sets CRUD absorbed into Assignments (set picker + settings disclosure); quick-change becomes a printable view linked from Checkout and the comp hub; old URLs still resolve; dead `/costumes/alterations` stub deleted with `backTarget` default corrected (absorbs part of T143).
- [X] T153 Wardrobe adopts the idioms (US14): `+ Add` drawers for create; row-local `<details>` edit panels that EXPAND the row (never floating — `table.members` clips); inventory filter row → search + kind + "More filters"; section-local `Object.hasOwn` error maps; searchParam guards; every costumes action resolves posted piece/set/student/competition/assignment ids in-program (costume_assignments carries a cross-tenant unique index).
- [X] T154 Quick change teaches its model (US15): one-line explainer, human transition names ("Opener → Ballad"), print-friendly, per-ensemble titled grids (supersedes T143's explainer line).
- [X] T155 Wave-W verification: full gate + e2e + static visual pass (1280/375, both themes, contrast, no clipped panels).

## Phase 6 — Wave 6: People

- [X] T137a Roster depth (coverage): `roster/ensembles` + `[ensembleId]` adopt drawer-create / row-edit idioms; `roster/import` 3-phase flow gets a real step indicator ("Step 2 of 3") and its three error taxonomies become one reviewable list; `roster/settings` (size fields) plain-language pass.
- [X] T137 Guardian row (US10): two affordances (Send family links · Edit popover with update/reset/remove); merge near-synonym send actions into one canonical action; email-issues rows link to the in-place fix; student page grouped Profile · Sizes · Guardians · Status.
- [X] T138 Wave-6 verification: full gate + e2e + visual QA.

## Phase 7 — Wave 7: Hosting

- [X] T139 Visible host command center (US11): schools + schedule as visible tables; mutations in labeled disclosures with live-count summaries; generate-schedule as primary; toast searchParams collapsed.
- [X] T140 Wave-7 verification: full gate + e2e + visual QA.

## Phase 8 — Wave 8: System pass

- [X] T141 Role-aware mobile tabs: `MobileNav` backfills tab slots from the viewer's visible nav items (ordered preference), More sheet holds the rest.
- [X] T142 Shared components: one SubTabs (six copies retired, one visual class), one ShareLinkCard (three duplicated blocks retired), `<Flash>` helper adopted on hotspot pages (shifts, hosting, trip, treasury).
- [X] T143 Dead-weight cleanup: `support_access` flag removed from registry (real gate documented), `/costumes/alterations` stub deleted (backTarget default corrected), single `TIMEZONES` source, quick-change explainer sentence.
- [X] T143a Slug-redirect hardening (Wave-1 review follow-up): every module-page `fail()`/redirect that interpolates the form's `slug` goes through the fail-closed `returnPath`/`programPath` guard (protocol-relative open-redirect class fixed app-wide, F6 pattern); rollover page `ERR[sp.error]` gets the Object.hasOwn + array-typed-param guards like the season page.
- [X] T143b Row panels must leave the last table cell (Wave-6 residual, measured): on the 7-column ledger the `#fix-<id>` panel lands 466px into a 343px viewport — **0% visible at 375px**, and sizing cannot reach it; `.wardrobe-row-panel` has the same flaw on its 8-column table. Move the panel out of the last cell (full-width row beneath, or a details row spanning all columns) rather than resizing it.
- [X] T144 Wave-8 verification: full gate + e2e + visual QA (per-role mobile nav screenshots).

## Phase 10 — Wave 10: Comp-week children (runs after Wave 8)

- [X] T156 Itinerary editor to the standard idioms: per-item row-local `<details>` edit (expanding), one "Add an item" drawer, section-local errors; publish→confirm gate and living-itinerary semantics untouched (parents never see unpublished times).
- [X] T157 Absences + list + thin children: `competitions/absences` renders `<Restricted>` instead of bare `notFound()` for disallowed roles (app-wide convention); outcome emails unchanged; `competitions` list keeps packet-attach + absence nudge while deferring create to the Season drawer; attendance/meals plain-language headers + shared flash convention.
- [X] T158 Wave-10 verification: full gate + e2e + visual pass.

## Phase 11 — Wave 11: Calendar & records

- [X] T159 Events calendar + detail: both views kept, create defers to the Season drawer as primary path, detail adopts row/edit idioms; `history` plain-language + flash convention.
- [X] T160 Today re-verified end-to-end after every wave: every inbox row, readiness row, comp-week shortcut and aside card points at a surface that still owns that job (Wave 3 moved several); dead links are a release blocker.
- [X] T161 Wave-11 verification: full gate + e2e + visual pass.

## Phase 12 — Wave 12: Money reporting

- [ ] T143c Row Edit triggers measure 38px, not 44px (Wave-10 residual): the shared `.comp-disclosure` min-height cannot apply to an inline `<a>`, so eight call sites across five surfaces (itinerary, ledger, budget, ensembles, inventory/assignments) sit under the touch target the rest of the app holds. One-selector fix + re-measure all five.
- [X] T162 `budget-vs-actual` + `reports` adopt Wave-4 vocabulary and the collapsed-filter idiom; board-snapshot PDF and "reconciled through" line unchanged (fiduciary controls stay as designed).
- [X] T163 Wave-12 verification: full gate + e2e + visual pass.

## Phase 13 — Wave 13: Settings & entry

- [X] T164 `settings` → titled sections in constant order (Program · Share links · Email health · Support access) with mutations in labeled disclosures; `members` + `export` adopt the row-edit idiom.
- [X] T165 `settings/rollover` full plain-language pass + real step indicator (it is rollover-only since Wave 1); `launch` + `invite` share one `TIMEZONES` source (absorbs part of T143), multi-state flows and role assignment preserved.
- [X] T166 Wave-13 verification: full gate + e2e + visual pass.

## Phase 14 — Wave 14: Parent surface (verification and polish, NOT a rebuild)

- [ ] T143d CSS handoff from Wave 12 (globals.css, currently owned by a separate 44px task): `td.num`/`th.num` are unstyled so every money column outside `.money-ledger` left-aligns — add `table.members td.num { text-align: right }` and let `.money-ledger` go back to being ledger-specific; `.money-filters a` (the Clear link, 33×21) and `.subtabs` links (36px) are under the 44px target across all six surfaces; add a comment on `.stack`'s `align-items:flex-start` shrink-wrap trap, which silently rendered two money tables 81px and 94px wide at 1280px.
- [X] T167 Re-verify every parent route after the staff-side changes: published-only gates, token capability allow-list unchanged, directory-tier PII only, program-tz dates, ≥44px tap targets, absence/signup outcome emails still send; `link-help` enumeration-safe + rate-limited behavior verbatim.
- [X] T168 Wave-14 verification: full gate + e2e + visual pass (parent surface at 375px is the primary case).

## Phase 9 — Wave 9: Tutorials & first-use refresh (runs LAST, after ALL waves above)

- [ ] T143e Destructive one-click share-link revoke has no confirm (Wave-13 finding): revoking kills the URL irrecoverably — the family must be re-issued and re-told — and it is the only irreversible action in the app without a confirm step. Decide: add the app-wide confirm idiom, or document why this one stays one click.
- [ ] T169 ESCALATION (needs schema, RQ-3): the "Updated {when}" living-itinerary banner is blind to DELETIONS — `changedItemsSincePublish` reads `itinerary_items.updated_at`, and a deleted row leaves no row to read. A director who removes an item after publishing gets no banner, so families keep a schedule line that no longer exists. Closing it needs a deleted-at or audit column; decide before it ships.
- [ ] T143f Parent-surface tap targets (Wave-14 measured, globals.css): `.itinerary-links a` 24.8px, `.token-footer a` 36.3px (four links, every page), absence `select` 36.4px, link-help email input 41.2px. Wave 14 verified three rules take all four to 44px with no overflow regression — see its report.
- [ ] T145 Journey re-derivation (US12): all role journeys in `lib/guide.ts` re-pointed at rebuilt flows (steps, links, labels, verifiers); non-director journeys reflect rebuilt surfaces + Wave-8 mobile nav; e2e guide contracts updated coherently.
- [ ] T146 Strip re-justification (US12-2): each of the eight IntroStrips rewritten for the new UI, shortened, or removed where the rebuilt surface self-explains; `?help=1` + Got-it semantics preserved for survivors; parent welcome card reviewed.
- [ ] T147 Wave-9 verification: full gate + e2e + visual QA (fresh-program walkthrough per role, journey panel states, surviving strips).
