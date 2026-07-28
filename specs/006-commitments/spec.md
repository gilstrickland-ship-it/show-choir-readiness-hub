# Feature Specification: Commitments (purchase orders & expected money)

**Feature Branch**: TBD (follows `claude/simplicity-rebuild-005`)

**Created**: 2026-07-28

**Status**: Draft — awaiting confirmation of the D4 correction below

**Input**: User request: "add a purchase order system. Should include money in from the PO and money out from the use of the PO." Clarifications given: money-in means *"a funding award to spend against"*; approval is *"normally a process of the school issuing the request and the Treasury managing it and the use of it."*

**Research**: full brief with sources in `docs/research/purchase-orders-2026-07.md` — state auditors (Ohio, NY OSC), NYSED/NCES/PASBO, district purchasing and ASB manuals, four district booster manuals, IRS EO CPE 1993 + *Capital Gymnastics* (T.C. Memo 2013-193), NFHS, Parent Booster USA.

---

## 1. What the platform is missing

The ledger records money that **has moved**. A budget records what was **planned**. There is nothing in between — no record of what has been **promised**. So "how much of the costume budget is still free?" is unanswerable today: a director sees $4,000 planned minus $800 spent and reads $3,200 available, when $3,200 is already committed to a vendor.

That middle layer is the entire feature. Everything else serves it.

**Planned → Committed → Spent → Still available**

## 2. The correction to the original premise (decision D4)

The request asked for "money in from the PO and money out from the use of the PO." Research finds that **an inbound purchase order is not a real accounting object**: encumbrances reserve *appropriations* (spending authority) and have no revenue analogue. Building one record with an in/out toggle would teach directors a false model.

The underlying *need* is real, and practitioners have distinct names for it. This spec therefore defines **one mechanism with two subtypes**:

| Subtype | What it is | Effect on money |
|---|---|---|
| **Spending commitment** (the PO) | We have promised to pay a vendor | **Reduces** still-available on its budget line, before any cash moves |
| **Expected money** | Someone has promised to pay us — a district allocation, grant award, sponsorship pledge, or an invoice to another district that owes us entry fees | Does **not** increase available budget until it actually arrives; shown separately as "expected" |

The asymmetry is deliberate and is the accounting reality: you may not spend money you have merely been promised.

## 3. The two purses (the actual wedge)

A show-choir program spends from **two separate pockets**: a district/activity account and a booster (501(c)(3)) account. Research finding: **no tool today can answer "how much of this budget line is still free?" across both.** The district ERP models encumbrances but the director cannot see it without the bookkeeper, and the booster half is not in it at all. Booster tools (MoneyMinder, BoosterHub) have no commitment concept whatsoever.

**D12 — blend the reporting, segregate the records.** Every commitment carries exactly one `funding_source` (`district` | `booster`). Numbering, identity, and tax treatment never mix. The director's "still available" view blends both.

**Non-negotiable legal constraint**: a booster must never issue, or appear to issue, the district's purchase order, tax ID, or sales-tax exemption. Ohio guidance, AVUHSD board policy, and the Texas Comptroller each prohibit it by name. The data model makes the wrong thing hard: exemption certificates are stored per funding source, not per commitment.

## 4. Approval — matches the stated process

The user's description — *the school issues the request, the treasury manages it and its use* — is also the documented best practice and the reason the feature has anti-fraud value.

- **Director/admin creates a request.** (This is a deliberate, tested relaxation of today's treasurer-only money write, and must be recorded as such in the RLS suite.)
- **Treasurer approves, issues, records payments against it, and closes it.**
- **`approved_by ≠ requested_by`, enforced in the database**, not the form. Self-approval is the exact failure mode NCES, NFHS, AVUHSD and Harvard's policy all prohibit, and it is what a treasurer-only model would force.
- **Thresholds (D6)**: two editable numbers per program — "needs a second approver above $X" (default $250) and "needs board approval above $Y" (default $1,000) — plus a "get three quotes above $Z" nudge. Real policies vary too much for a fixed ladder and too little to justify a rules engine.

## 5. Requirements

- **R1 — Commitments are their own table, never ledger rows.** A commitment is not money that moved; putting it in `ledger_entries` would corrupt every actual and break the monthly bank reconciliation control (commitments never appear on a bank statement).
- **R2 — Append-only, like the ledger.** Amount changes create a **revision** row referencing the original; the original is superseded, never edited. The top finding in a real district audit was literally *"Purchase orders are being altered after the fact"*; the auditor's rule is that a modification is a new document. The button may still say "Change amount".
- **R3 — Drawdown.** Linking a ledger entry to a commitment decrements its remaining balance and leaves it open. Show "committed $3,200 · paid $3,050 · $150 still committed". The link lives inside the existing Wave-4 "Connect it" disclosure — one more optional select, **not** a fifth always-visible field. From a commitment's page, "record a payment against this" pre-fills everything, so most entries never touch it.
- **R4 — Closing releases the remainder explicitly**, with visible confirmation ("$150 goes back to Costumes") and a recorded `released_cents`. Never auto-close: silently re-inflating available balance hides under-delivery.
- **R5 — Overspend warns, never blocks.** Reality overruns commitments; blocking guarantees the feature goes unused. Flag it and show it.
- **R6 — After-the-fact commitments are allowed but marked** ("Recorded after the purchase"), in neutral copy. This is the #1 documented policy violation and the flag is the single most valuable number on a board snapshot.
- **R7 — Stale open commitments surface** on Today and in the season-rollover flow. Open POs from a prior year are themselves a named audit finding.
- **R8 — No `student_id`, ever.** A commitment ties to a budget line — a program-wide purpose. Tying committed money to an individual student is the private-benefit hazard that cost *Capital Gymnastics* its exemption, and the same line this platform already drew by refusing individual fundraising accounts.
- **R9 — Vocabulary (D3).** Never "encumbrance" in the UI. "Committed" for the state; "Purchase order" only for `district` commitments (that is the word the bookkeeper will ask for); "Approved spending" for `booster`. Headline number: **"Still available"**.
- **R10 — No vendor-facing printed PO in v1 (D7).** Track the commitment and the district's PO number; do not generate a document a vendor is asked to honor. A booster-printed PO must carry the booster's own identity and exemption, and a district PO can only be issued by the district's system with the treasurer's certification — getting this wrong is the "acting as the district's agent" violation every manual prohibits.

## 6. Minimal record

**To request (5 fields):** vendor · purpose ("Premiere costumes — spring set") · amount · **budget line** (load-bearing: no line, no encumbrance, no math) · need-by date.

**System-assigned:** commitment number (sequential per program *per funding source*, never user-entered) · funding source · status · requested_by/at · approved_by/at · season · program.

**Later, at the right moment:** quote attachment (above threshold) · board-minutes reference (above threshold) · shipping & tax (before issue — omitting them is the top cause of invoice > PO) · received_at/by · linked ledger entries · closed_at/release · revision_of.

**Deliberately absent:** `student_id`, a user-editable number, an in/out toggle, cross-source tax-exemption reuse, hard delete.

## 7. Open decisions

- **D2 — line items vs single amount.** Recommend single amount in v1, line items only when the product prints documents (R10). Single-amount cannot support three-way matching.
- **D14 — split-purchase detection.** Recommend a soft inline nudge only (same vendor + line within 30 days crossing a threshold neither crossed alone); it is a named unlawful pattern, but false positives are guaranteed, so no report and no blocking until there's evidence someone would read it.

## 8. Sequencing

This is a **new capability inside a simplification project** — it adds surface, deliberately. It gets its own wave rather than riding Wave 12's reporting polish, and it must land **before Wave 9 (tutorials)** so the first-use guidance covers it.
