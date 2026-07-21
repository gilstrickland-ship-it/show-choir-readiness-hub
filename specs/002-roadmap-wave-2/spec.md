# Wave 2 Roadmap — Feature Spec

Six approved items from the July 2026 product review (`docs/product-review-2026-07.md` §5). Designed by Fable; implemented by Opus agents in waves F–I. This spec is authoritative for wave-2 work; the platform architecture spec (`specs/001-octv-platform/architecture-spec.md`) and constitution still govern everything it doesn't override (it overrides nothing).

Constitution checkpoints that bind every item below: I (RLS + tests with any new table), II (no parent/student accounts; token allow-list stays tiny), III (directory-tier PII only — host-mode stores *adult professional contact* info for visiting directors, which is directory-tier by definition; never students of visiting schools), IV (AI drafts only — wave 2 adds **zero** AI surfaces), VII (timestamptz + program tz), VIII (build complete, expose by flag), IX (brand via `lib/brand.ts` only).

---

## F1. Pilot-ready deliverability (docs + in-app health, no DNS in code)

DNS and Resend dashboard work cannot be code. What ships:

1. **`docs/deliverability-runbook.md`** — the exact, ordered checklist to take a deployment from zero to pilot-ready email: Resend domain verification, the SPF/DKIM records Resend issues, a DMARC record recommendation (`p=none` → `p=quarantine` after warm-up), `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `INBOUND` webhook URLs (`/api/webhooks/resend`, `/api/webhooks/resend-inbound`), warm-up guidance (first sends to staff before the first all-family announcement), and how to verify end-to-end (send announcement to self, bounce a test address, watch `email_status` flip). Written for a semi-technical operator (the person deploying), not the director.
2. **Email health card** on Settings → Program (`SETTINGS_ROLES` only): server-rendered checks, each ✓/– with one plain sentence:
   - Sending configured — `RESEND_API_KEY` present.
   - Webhook signing — `RESEND_WEBHOOK_SECRET` present (bounces/unsubscribes verified-signed).
   - From-address domain matches `brand` config (catches the placeholder-domain foot-gun).
   - Guardian inbox health — N ok / N bounced / N unsubscribed (links to the email-issues page).
   No env values are ever displayed — presence booleans only, evaluated server-side. Copy stays non-technical ("Ask whoever hosts your deployment to…" pattern from wave B).

## F2. CutTime/Charms import presets

`lib/roster/import.ts` already normalizes headers aggressively. Add:

1. **Header synonym packs** (pure data + mapping extension): recognized synonyms observed in Charms/CutTime exports — "Student: Last Name", "Adult 1 First Name"/"Adult 1 Last Name" (guardian first/last split columns → concatenate at parse into guardian name), "Adult 1 E-mail", "Home Phone"/"Cell Phone" (guardian phone), "Grade" (→ grad year via `gradYearFromGrade(grade, referenceYear)` helper: 12→refYear+1 when import happens Aug–Dec, refYear when Jan–Jul — expose the helper pure with an explicit `now` param for tests). Guardian-first/last split and Grade are the two genuinely new mapping behaviors; everything else lands as synonyms in the existing `mapColumn` paths. All unit-tested with realistic fixture headers.
2. **Import page hint**: one line under the upload control — "Exports from Charms or CutTime work as-is — no cleanup needed."
3. **Landing page**: add a feature card to the FEATURES grid — title "Switching from Charms or CutTime?", body: import the roster export you already have, students + parent contacts in one pass, nothing to retype — "migrate in a weekend" phrasing. No competitor disparagement; factual.

## G1. Staff season calendar feed (.ics)

Parents got per-competition ICS; directors want the whole season in Google Calendar, live.

1. **Schema**: extend `share_link_resource` enum with `'season_calendar'` (migration 0010; `ALTER TYPE ... ADD VALUE`). `resource_id` = season id. No new tables.
2. **Feed route** `app/(public)/t/[token]/calendar/route.ts`: share-token only (`resource:view`), resource must be `season_calendar`; emits `text/calendar` for the season's competitions (all-day VEVENT on comp date, or timed from the published itinerary's first item when present), events, and trips (all-day span). Published-itinerary detail only — draft itineraries contribute nothing beyond the comp's date. Rate-limited like every token surface; revocable like every share link. Include `X-PUBLISHED-TTL`/`REFRESH-INTERVAL` hints (PT12H).
3. **Mint UI**: Season page (staff, `SETTINGS_ROLES` ∪ existing comp-write roles — follow the shifts-page mint pattern): "Subscribe in your calendar" box → mints/rotates the share link, shows the `webcal://`-style URL once with plain instructions ("Paste into Google Calendar → Other calendars → From URL. It stays current all season."). Listed/revocable in Settings share-links table like the others (it already lists all share links generically — verify label rendering for the new resource).
4. **Reuse** `lib/ics.ts` — extend the builder to accept all-day events (DATE-valued DTSTART) alongside timed ones. Unit-test.

## G2. Multi-day trip itineraries (day views, no schema change)

Itinerary items are timestamptz and may already span days; the UI renders one flat list. Ship day-aware rendering everywhere times render, keyed by `zonedDateKey` in program tz:

1. **Staff itinerary editor**: when a published/draft itinerary's items span >1 calendar day, group under day headers ("Friday, Apr 10"). Single-day itineraries render exactly as today (no header noise).
2. **Parent itinerary page**: same grouping, same threshold.
3. **Parent packet PDF**: day subheadings within the Itinerary section under the same condition.
4. **Per-competition ICS** (existing route): already per-item; no change beyond verifying multi-day output.
5. **Trip schedule view**: on `travel/[tripId]`, when the trip spans >1 day (`starts_on != ends_on`), render a read-only "Trip schedule" section merging, per day: the linked competition's published itinerary items + program `events` whose `starts_at` falls inside the trip's date range (program tz). Empty days render as "—  nothing scheduled yet". This is how a nationals "park day" appears: staff create it as an event (kind `other`/`banquet`); it slots into the trip's day view. Add one muted hint line in the empty state telling staff exactly that ("Add park days, meals, and free time as events — they'll show here on the right day").

## H1. Travel assignment — drag-free bulk flow for phones

Keep server-component architecture (no client state library; small `'use client'` islands only where a form genuinely needs interactivity — this qualifies). Design, replacing the select-a-student→scroll→assign round-trip for phones:

1. **Sticky target bar** (mobile + desktop): staff first tap a group card's "Fill this bus/room" affordance → that group becomes the *active target*, shown in a sticky bar pinned to the viewport bottom (`position: sticky/fixed` within the page, styled like the mobile tab bar): "Filling **Bus 1** · 23/48 · [Done]".
2. **Queue chips**: with a target active, the unassigned queue renders as large tap-chips (name + needs-bus/room badge). Tapping a chip assigns that student to the target **without navigation jank** — implement as a small client island wrapping the existing server action via `useTransition` + `router.refresh()` (or plain form POST per current pattern if the island proves unnecessary — agent's call, but zero new dependencies and no optimistic local state that can lie; the count in the sticky bar re-derives from server data after refresh).
3. Capacity: the bar shows count/capacity climbing; over-capacity keeps the existing warn-not-block behavior.
4. "Done" clears the target (back to the browse layout). Desktop keeps the existing two-pane flow working unchanged alongside; the one-tap per-card select from wave D remains.
5. No drag-and-drop anywhere (hostile on phones, inaccessible).

## I1. Host-mode module (flag `hosting`, default **off**)

The program *runs its own invitational*: the single biggest fundraiser (research: $32–35K) and ops lift. Staff-only surface; visiting schools have no accounts (mirrors Constitution II — their surface is email + what the host prints/sends). Zero AI. New nav slot behind the flag: **"Hosting"** (appears in Season? No — its own slot in the More/nav per `lib/nav.ts` pattern, `SETTINGS_ROLES` + `admin`-equivalent write, board read).

### Schema (migration 0011, with RLS + tests in the same change)

```sql
hosted_events   (id, program_id, season_id, name, event_date date, venue_notes text,
                 status enum hosted_event_status ('planning','scheduled','done'),
                 created_at, updated_at)
hosted_schools  (id, program_id, hosted_event_id, school_name, ensemble_name,
                 director_name, director_email, director_phone,     -- adult professional contact only
                 performer_count int, division text,                -- "Large Mixed", host-defined free text
                 costume_colors text,                               -- for homeroom decoration (research norm)
                 homeroom text,                                     -- room label, e.g. "Rm 214"
                 arrival_notes text, sort_order int,
                 created_at, updated_at)
hosted_slots    (id, program_id, hosted_event_id, hosted_school_id nullable,  -- null = break/awards/meal
                 kind enum hosted_slot_kind ('warmup','perform','break','awards','meal','other'),
                 label text,                                        -- "Awards — daytime", or auto from school
                 starts_at timestamptz, duration_minutes int,
                 sort_order int, created_at, updated_at)
```

Notes: **no student data of visiting schools, ever** (counts only). Free-text fields carry the standing no-health label. All three tables get the standard coarse RLS policies + write-role gates (director/admin write; treasurer/costume_manager none; board read) and land in the same migration as their policies. The RLS isolation suite picks them up automatically (program_id enumeration).

### Surfaces

1. **Hosting home** (`/[program]/hosting`): list of hosted events + create form (name, date). Empty state explains the module in two sentences.
2. **Event page** (`/hosting/[eventId]`): three sections, one page (command-center idiom from comp week):
   - **Schools** — add/edit rows (school, ensemble, director contact, performer count, division, costume colors, homeroom, arrival notes). Homeroom is a plain text label; a "rooms in use" summary chip warns on duplicate homeroom assignment (warn, never block — schools can share).
   - **Schedule builder** — ordered slot list. "Generate schedule" seeding action: given a start time, per-school warm-up + perform durations (defaults 25/25 min), and optional lunch/awards insert points, materialize `hosted_slots` rows in school `sort_order` (warm-up slot then perform slot per school, offset so warm-ups lead performances by one slot — keep the generator simple and deterministic; director reorders/edits after). **Compressible slots**: a "Shift remaining" action on any slot — enter ±minutes, every later slot's `starts_at` moves by that amount in one transaction (the research-documented "shave 5 minutes when running behind" move, done in one tap instead of retyping the afternoon). All times program tz.
   - **Day-of documents** — links to the PDFs.
3. **PDFs** (React-PDF, derived-not-stored, same pipeline):
   - **Master schedule** — the slot grid (time, school, kind), for judges' table and backstage.
   - **Homeroom door signs** — one page per school: school name big, ensemble, homeroom label, costume-colors line (decoration cue), warm-up + perform times.
   - **Director packet (per visiting school)** — one page per school: their warm-up/perform/awards times, homeroom, arrival notes, venue notes, host contact (brand + program), the master schedule appended.
4. **Wiring into existing rails** (build-complete): a hosted event may be linked from the Season spine (render as a distinguishable row when the flag is on); volunteer shifts already attach to `event_id` — hosting does NOT get its own shift system; instead the hosting event page links "Volunteer shifts" → create a matching general `events` row? **No** — keep it simpler and honest: the hosting page shows a hint to create shifts attached to *nothing* ("standalone") or to a general event the staff makes for the day. No schema coupling in wave 2. Document this as the deliberate seam.

### Flag & tiers

`hosting: { default: false }` in the registry; not in any tier bundle for now (per-program override enables pilots — same posture as `support_access`, product decision recorded here).

---

## Task IDs

Phase 11 in `specs/001-octv-platform/tasks.md` (continuing the single build log, matching Phase 10's precedent):
- T048 Wave F — deliverability runbook + email health card (F1); CutTime/Charms import presets + landing card (F2).
- T049 Wave G — season_calendar share resource + staff ICS feed + all-day ICS support (G1); day-grouped itineraries + trip schedule view (G2).
- T050 Wave H — travel sticky-target bulk assignment flow (H1).
- T051 Wave I — hosting schema + RLS + tests (I1 schema).
- T052 Wave I — hosting surfaces + schedule builder + shift-remaining + PDFs + nav/flag (I1 UI).

Verification gate per wave: `typecheck · test:unit · test:rls · build`, e2e reconciled statically where copy/flows change.
