# Implementation Plan: Simplicity Rebuild — Wave 1 (Season Manager)

**Spec**: `specs/005-simplicity-rebuild/spec.md` · **Branch**: `claude/simplicity-rebuild-005`

## Technical approach

Wave 1 is flow-and-presentation only: no migrations, no new tables/columns, no RLS or flag changes, no new client components. Every mechanism it needs already exists in the codebase:

- **Quick-add drawer**: the `.drawer` pattern (`app/globals.css` ~line 2928; used on `roster/page.tsx:155` and `treasury/page.tsx`) — a native `<details>` popover, `open` driven by `?error=` so failed validation reopens it server-side.
- **Row edit popovers**: the `<details className="stack">` edit idiom from `travel/[tripId]/page.tsx:473` (T064).
- **Server actions**: `createCompetition` / `createEvent` / `createTrip` and `updateCompetition` / `updateEvent` / `updateTrip` already exist with role re-checks. They gain a *return-path* awareness (`from=season` hidden field) so validation errors and successes redirect to `/season?...` instead of the module pages. Never trust a client-supplied URL — the action maps `from=season` → `/${slug}/season` itself (allow-listed values only).

### A. Season page quick-add (US1)

`app/(app)/[program]/season/page.tsx`:

1. Replace the three per-kind header links with one `+ Add` drawer (writer roles only; per-kind sections inside gated exactly as today: `canAddComp`, `canAddEvent`, `canAddTrip`). The drawer summary is the accent button; inside, a kind switcher (three `<details name="season-add-kind">` accordion sections or radio-styled links `?add=comp|event|trip` — implementer's choice, but server-first, no JS; mutually-exclusive accordion via the `name` attribute is the zero-roundtrip option).
2. **Competition quick-add**: Name, Date, ensemble checkboxes (rendered only when `ensembles.length > 1`, all pre-checked; a single ensemble becomes a hidden input — mirrors the multi-ensemble rules from spec 004). Hidden: `status=planned`, `from=season`. Ensembles-empty case renders the P1-scenario-7 message instead of the form. "More options →" links `/competitions#add`.
3. **Event quick-add**: Title, Starts (datetime-local). Kind select (default rehearsal) inline — it's one control and directors do use it. Collapsed sub-disclosures: "Only some groups?" (ensemble checkboxes, none checked = whole program — unchanged semantics) and "Repeats weekly?" (`repeat_count`). Location + note stay on the full form ("More options → `/events#add`").
4. **Trip quick-add**: when comps-without-trips exist, primary path = select of those comps (submit inherits name/dates server-side — reuse the existing prefill semantics from `travel/page.tsx:133-165` but move the inheritance into the action so the quick-add needs no hidden per-comp fields); plus an "Overnight" checkbox. Standalone alternative: Name, Starts, Ends, Overnight. "More options → `/travel#add`".
5. Drawer `open` state: `?error=` present AND `?add=<kind>` matches → that kind's section open (roster pattern extended with the kind key).
6. The `?created=` highlight: on return, the new row gets a subtle highlight class (match `alert-ok` tone); acceptable to skip row-level highlight if the spine row count makes anchor-scrolling (`#item-<key>`) simpler — but the user must land on `/season`, not a module page.

`competitions/actions.ts`, `events/actions.ts`, `travel/actions.ts`: accept `from` (allow-list: `"season"`), thread it through every `redirect()` in the create paths (`?error=X&add=<kind>` on failure to `/season`, `?created=…` on success to `/season`). Existing module-page flows (no `from`) keep today's redirects byte-for-byte. `createTrip` additionally: when `competition_id` is set and `name`/`starts_on` are blank, inherit `"<comp name> — travel"` and the comp date (server-side; removes the hidden-field prefill contract from the travel page too — one code path).

### B. Spine row edit popovers (US2)

`season/page.tsx` rows: for writer roles, an "Edit" affordance per row (comp/event/trip kinds only — hosting rows unchanged) opening a `<details>` popover with the kind's minimal fields pre-filled:
- comp → `updateCompetition` (name, date, status; ensembles stay detail-page — pass current ensemble ids as hidden inputs since the action requires ≥1; popover links "All details →" to the comp).
  - **Check during implementation**: if `updateCompetition` treats absent ensemble fields as "no change", prefer omitting them entirely over hidden inputs (stale-hidden-state risk).
- event → `updateEvent` (title, starts_at, location; audience linked out to `/events/[id]`).
- trip → `updateTrip` (name, starts_on, ends_on, overnight — semantics + room-safety guard untouched).
All three updates gain the same `from=season` return-path handling. Popover markup must stay lean — the spine renders many rows; no queries may be added per-row (all data needed is already loaded; events need `location` added to the select — one column).

### C. First-season start card (US3)

New shared server component `app/(app)/[program]/StartSeasonCard.tsx` + action `startFirstSeason` (in `settings/rollover/actions.ts` or a season-local actions file): renders only when `seasons.count === 0` for `SETTINGS_ROLES`; one visible field (label, pre-filled from program-tz today: Aug–Dec → "YYYY–(YY+1)", Jan–Jul → "(YYYY-1)–YY" — a tiny pure helper in `lib/datetime.ts` or `lib/seasons.ts` with unit tests), dates behind a collapsed "Set season dates" disclosure. Action = create + activate in one path (reuse `createRolloverSeason` + `activateNewSeason` logic — factor, don't duplicate), redirect back to the referring surface (`from` allow-list: `season` | `dashboard`).
Today (`dashboard/page.tsx`) and Season currently render the "No active season yet → Settings" alert; both replace it with: zero seasons → the card; seasons exist but none active → today's alert (link to Settings → Seasons). The card body for non-settings roles: informational sentence, no form.
`settings/rollover/page.tsx`: drop the `isFirstSeason` branching (the wizard is now rollover-only; keep a link to it from the card's "rolling over from a previous year?" footnote), rename Step 4 copy to "Copy costume set names into the new season", audit remaining steps for jargon.
**e2e contract caution**: spec 003 preserved the journey-panel heading "Set up your program" + step-1 link "Start your season" pointing at `/settings/rollover` — the journey step target may change to the in-place card only if `tests/e2e` specs are reconciled in the same task; otherwise point the journey step at Season and keep the wizard reachable.

### D. Calendar box → disclosure (US4)

`season/page.tsx`: wrap the subscribe `confirm-box` in `<details className="drawer">`-style disclosure (or a plain `<details className="stack">` — visual call, keep it one line collapsed: "📅 Subscribe in your calendar"). `open` when `calShare` or `calError` present. Contents unchanged. `actions.ts` untouched.

## Verification

- Full gate: `npm run typecheck && npm run test:unit && PG_BIN_DIR=<embedded-pg>/native/bin npm run test:rls && npm run build` (embedded postgres per AGENTS/memory: `@embedded-postgres/darwin-arm64@16.14.0-beta.17` in the scratchpad).
- Unit tests: new label-default helper; any factored season-create logic.
- e2e: statically reconcile `tests/e2e` (staff journey creates comps/events via module forms today — those forms remain, so changes should be additive; anything touching "Start your season" or Season-page affordances must be updated) then `npx playwright test --list --config playwright.config.e2e.ts`.
- Visual QA (memory lesson — never text-only): screenshot Season page states in the local build where renderable; rendered-contrast sweep on changed surfaces; 375px pass (drawer panel width, popovers).
- Copy: every new string plain-language; free-text inputs that reach staff/parents keep the health-info caution label where the pattern already applies.

## Risks

- **e2e drift** is the biggest: T063 explicitly added the per-kind + buttons and #add anchors with e2e coverage. Keep `#add` anchors working; update specs that assert the three header links.
- `<details name="…">` accordion needs a browser-support sanity check in this codebase's targets; fall back to `?add=` links (server round-trip) if not acceptable.
- Popover-in-spine layout on mobile: absolute-positioned `.drawer-panel` is right-anchored; rows may need a left-anchored variant.
