# Product Review — July 2026

A full product-manager review of the Season OS platform for competitive show choir, conducted from the standpoint of its real users: **non-technical high-school directors and booster-club parents**. The review combined a screen-by-screen audit of the staff app, a full walk of the parent token surface and email pipeline, and outside research into how US show choir programs actually operate.

Everything in the "Shipped" sections below was implemented on branch `claude/product-review-polish`, verified against the full gate (`typecheck` · `test:unit` · `test:rls` (169) · `build`), with spec-kit traceability (tasks T042–T047 in `specs/001-octv-platform/tasks.md`).

---

## 1. Verdict

The platform is architecturally excellent — the constitution's guarantees (tenant isolation with a CI-blocking RLS suite, directory-tier PII only, AI as draft-producer, void-only money, derived documents, program-timezone rendering) are genuinely enforced in code, not just documented. The task-oriented IA ("Today / Season / People / Money / Wardrobe / Comms") and the Marquee Modern design pass had already landed before this review.

The gap was between that sophistication and the actual audience:

- **Parents were under-served on outcomes.** Every parent interaction (absence report, shift signup) was fire-and-forget — the system never told them what happened next. Research shows volunteer no-show rates of 10–20% without reminders, and education-sector email open rates around 25%; a pull-only surface loses those battles.
- **Developer vocabulary leaked everywhere staff look.** "Timezone (IANA)", raw enum values in dropdowns, `RESEND_API_KEY` on a director-facing screen, "mint/rotate/revoke tokens" on the single most sensitive family-links control.
- **The required setup order was undiscoverable.** Season → students → ensemble → competition was enforced by scattered "do X first" notices, and a brand-new director was dropped into a *rollover* wizard to create their first season.
- **A handful of real bugs**, two of them trust-critical date renderings (a class the constitution itself calls out: "a 7:15 AM call time rendered wrong once destroys trust forever").

## 2. Research grounding (selected)

- Competition-day schedules **drift**: hosts openly compress warm-up slots when running behind, so morning-printed times are wrong by afternoon (Productions Magazine, host-director account). → living-itinerary change banners; "this page always shows the latest."
- The **Sunday-digest + urgent-alert split** is the proven director communication pattern (band-director practice guides); the weekly digest matches it, and announcements cover the urgent lane.
- **SignUpGenius pain**: forgotten signups and 10–20% attrition without reminders (BoosterHub). → day-before shift reminder cron + signup confirmation emails.
- **Charms → CutTime forced migration** (Charms sunset Sept 2024) left thousands of programs mid-switch with manual exports — the wedge for a CSV-first onboarding story.
- **Per-student fundraising accounts are a 501(c)(3) hazard** (IRS private-benefit doctrine; Parent Booster USA). The fair-share card added to the budget page deliberately stops at a *group* per-student guide with an explicit caution — no individual accounts were built, on purpose.
- **Booster embezzlement is a recurring, documented reality** (NFHS; recent $125K–$200K cases). The platform's void-only ledger, treasurer-only writes, full-board read access, and board snapshot PDF are the right controls; they were left exactly as designed.
- Chaperone norms (~1:10 day-trip guidance), manifest sign-out practice, and pre-7am call times validated the travel/manifest touches.

## 3. What shipped in this review

### Wave A — Bug sweep (T042)
- Absences queue rendered competition dates **a day early** in US timezones (missing noon anchor) — fixed; same fix later applied to every parent-facing date (Wave D).
- Three screens still pointed users at a competition "Overview tab" that no longer exists.
- Four surfaces showed raw ISO dates (`2026-02-03`) instead of formatted dates.
- The Today countdown counted 24-hour blocks, not calendar days in program timezone ("1 day" on Thursday evening for a Saturday comp) — now calendar-day math.
- The magic-link screen claimed "check your email" even when no account matched — copy now honest without enabling account enumeration.
- Raw IANA zone names ("America/Chicago") replaced with a friendly-label helper ("Central Time") used across the app.

### Wave B — Plain-language sweep (T043)
- "Timezone (IANA)" → "Time zone" with friendly names; enum values (itinerary kinds, event kinds, piece condition, budget direction, member status, roles on the launch chooser) now render human labels everywhere.
- No raw env-var names, flag keys, or model/prompt identifiers anywhere staff look; packet-parse failures show a plain sentence with technical detail tucked into a disclosure.
- Treasury labels softened ("Paid to / received from"); dashboard money copy de-jargoned.
- The family-links control rewritten with zero token vocabulary: "Email links to this family" / "Reset this family's links", labeled copyable link rows instead of raw URLs.
- Import screen: "Size columns found", "combined from N rows" with explanation.

### Wave C1 — Parent notification layer (T044)
- **Absence outcome emails**: parents now hear back when staff confirm ("Absence confirmed") or dismiss ("student is still expected") their report; the parent-page badge softened from "Not approved" to "Not confirmed — student still expected".
- **Shift confirmation email** on token-link signup, with time in program tz and what the shift is attached to.
- **Day-before shift reminder cron** (new `reminded_at` column, idempotent claim-then-send, per-program `shifts` flag respected).
- **Unsubscribe compliance**: visible Unsubscribe footer link in every guardian email, RFC-8058 one-click `List-Unsubscribe` headers, a guardian unsubscribe page (new tightly-scoped `email:unsubscribe` capability), and a staff "Mark deliverable again" path back.

### Wave C2 — Parent surface UX (T045)
- **Add to calendar (.ics)** for published itineraries from the parent link (RFC 5545 builder, unit-tested; same security posture as the packet route).
- **Living itinerary**: parents see "Updated {when} — times can shift on competition day; this page always shows the latest"; staff who edit after publishing get a calm nudge to send an announcement (nobody is auto-notified — Constitution IV intact).
- **Self-service link recovery** (`/link-help`): enumeration-safe, hard rate-limited, emails fresh family links to addresses already on file — the #1 dead-end for a parent who deleted the email.
- Token-page tap targets to ≥44px; absence history table → phone-friendly stacked cards.

### Wave D — Staff workflow (T046)
- **First-run setup guide** on Today (season → students → ensemble → competition, role-aware links) replaces the empty hero for materially-empty programs.
- **"Start your first season"** framing: the rollover wizard fast-paths create → activate when there is nothing to roll over.
- **Mobile IA**: Wardrobe promoted to the phone tab bar (Money moved to More); comp-week hallway shortcuts (Attendance / Checkout / Quick change) appear on Today within 7 days of a competition.
- **Fair-share card** on the budget page (planned expenses ÷ students) with the 501(c)(3) group-benefit caution.
- **Bus manifest "Released" column** + family-release instruction line; chaperone-per-students info line on travel groups ("No chaperone assigned yet").
- **One-tap travel assignment**: add a student to a bus/room directly from the group card (the two-pane flow remains for desktop).
- Parent-page date noon-anchors (Constitution VII) swept.

### Wave E — Hardening + e2e reconciliation (T047)
- E2E journey suite updated to the redesigned flows (first-run guide, first-season wizard, absence cards).
- Confirm-boxes on the three people-impacting destructive actions (reset family links, remove guardian, remove member) — real confirmations, not tooltips.
- LIKE-metacharacter-safe address matching everywhere user-derived emails hit `ilike` (webhook, unsubscribe, link recovery).
- Undated competitions no longer silently vanish from the Season timeline.

## 4. Deliberately NOT built (with reasons)

| Idea | Why not |
|---|---|
| Per-student fundraising credit ledgers | IRS private-benefit hazard for 501(c)(3) boosters; the fair-share card stops at a group guide by design. |
| Allergy/dietary fields on meal forms | Constitution III categorically excludes health data; meal counts stay headcount-only. |
| Parent/student accounts of any kind | Constitution II; the token surface got better instead. |
| SMS/urgent text lane | Real want (day-of changes), but a Twilio dependency and cost/consent model deserve their own spec — documented Phase-2 in the architecture spec already. |
| Host-mode (running your own invitational) | Biggest adjacent opportunity found by research ($32–35K fundraiser per event, huge ops lift) — a genuine expansion module, not a polish item. |
| Rooming-policy engine (gender rules, ratio enforcement) | Spec explicitly rejects it (programs vary too much); shipped informational ratio lines only. |
| Distributed rate-limit store (Upstash) | Needed before multi-instance production; an infra dependency + env decision, not a code polish. Self-documented in `lib/rate-limit.ts`. |

> **Wave-2 addendum (July 2026, later the same month):** items 1–6 below were subsequently approved and built — see `specs/002-roadmap-wave-2/spec.md` and tasks T048–T052. What code can't do remains: the DNS/Resend dashboard steps in `docs/deliverability-runbook.md`, and the SMS lane (still deferred — vendor + consent decisions).

## 5. Recommended next (in rough priority order)

1. **Pilot-ready deliverability**: verified sending domain, DMARC/SPF/DKIM, webhook signing secret set — the unsubscribe/one-click machinery is now in place, DNS is not code.
2. **Urgent SMS lane** (Twilio) for day-of changes — the one channel gap research says matters most, now that email is compliant.
3. **Host-mode module** — registration, homeroom map, schedule builder with compressible slots, director packets. The research brief has the full shape.
4. **CutTime/Charms import presets** — the parser already handles messy headers; add recognized header synonym packs + a "migrate in a weekend" landing story for the displaced-Charms market.
5. **Travel two-pane deeper redesign on phones** — one-tap add shipped; a drag-free bulk flow (queue chips + sticky target) would finish the job for 50-kid buses.
6. **Multi-day trip itineraries** (nationals: per-day schedules, park days) — currently modeled as single competitions + trips; works, but a per-day itinerary view would fit HOA/FAME nationals better.
7. **Season calendar ICS for staff** — parents got add-to-calendar; directors would use a whole-season feed.

## 6. Sources

Key citations behind the research claims: Productions Magazine (hosting a show choir competition), Millard North Vocal Music parent handbook, Linn-Mar Supernova contest rules, BoosterHub (Charms sunset, SignUpGenius attrition, fair-share), Parent Booster USA + nonprofitlawblog (individual fundraising accounts), NFHS (booster embezzlement), United Educators (chaperone ratios), Wenger (quick-change practice), hoachoir.com / showchoirs.org / showchoirnationals.com (circuit formats), mailsoftly (education email open rates).

## 7. Convergence statement (July 21, 2026)

The review → research → build → re-review loop has closed. Waves A–L shipped: bug sweep, plain language, parent notifications + compliance, parent UX, staff workflow + mobile IA, e2e reconciliation + hardening, deliverability + import presets, season ICS + multi-day itineraries, travel bulk flow, host-mode module, 24 convergence fixes, living-itinerary resurrection, and the monthly reconciliation control.

Every research implication is now either shipped or documented-deferred with rationale. The reconciliation control closes the last research-flagged gap in the money surface (separation of duties and full-board transparency were already built; monthly bank-statement reconciliation was the missing third safeguard against booster embezzlement). Volunteer no-show buffering ships as guidance copy on the shift form.

The remaining deferred items require human or environment action, or new product decisions: the SMS lane (Twilio vendor + consent model), background-check tracking, volunteer waitlists, a distributed rate-limit store (Upstash), and the DNS/Resend deliverability steps. None is a code-polish item; each is self-documented where it lives.
