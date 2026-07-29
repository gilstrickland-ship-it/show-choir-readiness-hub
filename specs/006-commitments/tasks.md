# Tasks: Commitments (purchase orders & expected money)

**Spec**: `spec.md` · Numbering continues from 005 (last: T169).

Sequenced BEFORE spec 005's Wave 9 (tutorials), so first-use guidance covers commitments.

## Phase 1 — Schema

- [X] T170 Migration `0021_commitments.sql`: `commitments` table (program_id, season_id, **kind** `spending`|`expected`, funding_source `district`|`booster`, number, vendor, purpose, amount_cents, budget_line_id, need_by, status, requested_by/at, approved_by/at, received_at/by, closed_at/close_reason/released_cents, revision_of_id) + `commitment_audit`. Composite `(id, program_id)` FKs per 0017's pattern; **no `student_id`** (spec R8). Number is sequential per program **per funding source**, assigned server-side. RLS: read = `TREASURY_ROLES`; **create = director/admin/treasurer; approve/issue/close = treasurer**; `approved_by <> requested_by` enforced by CHECK/trigger (spec §4). Append-only: amount changes are revision rows, never UPDATEs of a financial column (R2) — enforce with a trigger mirroring `ledger_entries`'. Idempotent + re-runnable (0017/0019 pattern); pre-flight not needed (new table).
- [X] T171 RLS + unit coverage for T170: cross-program insert rejected; self-approval rejected; non-treasurer approve rejected; director create allowed; financial-column UPDATE rejected; revision chain readable. Extend the fk-integrity sweep so the new table is covered automatically.

## Phase 2 — Available-balance math (the reason the feature exists)

- [X] T172 Extend the money aggregates: a `commitment_totals(program_id, season_id)` SQL function and a per-line variant returning open committed cents, so **Planned → Committed → Spent → Still available** is computed in SQL and cannot depend on a row cap (the 0019 lesson). Budget-vs-actual, the ledger metric strip, and the board snapshot read the same source; `summarizeSeasonLedger`'s service-role path gets the matching helper so the PDF cannot diverge from the page. A failed read renders "—", never $0.00.
- [X] T173 Drawdown: linking a ledger entry to a commitment decrements its remaining and leaves it open; "committed $3,200 · paid $3,050 · $150 still committed". The link lives **inside the existing Wave-4 "Connect it" disclosure** — one more optional select, never a fifth always-visible field (R3). Resolve the commitment in-program *and in-season* before write (the 0019 tag rule).

## Phase 3 — Surfaces

- [X] T174 Commitments list + detail under Money, using the established idioms (drawer create, `?edit=` full-width row panel, shared `Flash`/`SubTabs`, live-summary heads). Detail shows the drawdown and its linked ledger entries; "record a payment against this" pre-fills the ledger drawer so most entries never touch the tag (R3).
- [X] T175 Lifecycle: request → approve → issue → partially received → received → closed, plus cancel/void and **revisions** (R2, the "change amount" button quietly writes a revision). Explicit close releasing the remainder with visible confirmation and recorded `released_cents` (R4). Overspend **warns, never blocks** (R5). After-the-fact commitments allowed but marked in neutral copy (R6).
- [X] T176 Expected money (the inbound subtype): same machinery, different labels and math — does NOT increase available budget until received; shown separately as expected. Covers district allocation, grant award, sponsorship pledge, and an invoice to another district that owes entry fees.
- [X] T177 Thresholds in settings (R/D6): two editable numbers per program — second approver above $X (default $250), board approval above $Y (default $1,000) — plus a "get three quotes above $Z" nudge. Stale-open-commitments nudge on Today and in the rollover flow (R7).

## Phase 4 — Verification

- [X] T178 Full gate + e2e (a treasurer/director pair walking request → approve → pay → close, and the self-approval refusal) + measured visual pass; production migration applied after review.

## Production migrations — APPLIED 2026-07-28/29

`0021_commitments` → `0022_commitment_drawdown_rows` → `0023_commitment_thresholds` applied and verified in that order, ahead of the code deploy as required (0023 is deploy-blocking: `lib/tenant.ts` selects the three `programs` threshold columns). `0024_itinerary_items_changed_at` followed with spec 005's T169. Production is at **0024**. Code shipped via PRs #20-#22.

## Resolved during implementation

- **shipping/tax are frozen at insert** (0021), so the spec's "add before issue" is unreachable: changing them afterwards is a revision. **Keep it** — it matches the audit rule the feature exists to honour ("a modification is a new document, not an alteration"), and it is stricter than the spec, not looser.

## Open decisions carried from the spec

- **D2** line items vs single amount — recommend single amount in v1.
- **D14** split-purchase nudge — recommend soft inline note only.
- **R10** no vendor-facing printed PO in v1 (legal exposure: a booster must never appear to issue the district's PO).
