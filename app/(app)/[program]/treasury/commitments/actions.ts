"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { programPath } from "@/lib/return-path";
import {
  COMMITMENT_ACTION_STATUS,
  COMMITMENT_CREATE_ROLES,
  TREASURY_WRITE_ROLES,
  commitmentAllows,
  parseCommitmentAction,
  parseCommitmentKind,
  parseDollarsToCents,
  parseFundingSource,
  type CommitmentAction,
  type CommitmentState,
} from "@/lib/treasury";
import {
  commitmentAnchor,
  isRowCommitmentError,
  type CommitmentErrorKey,
  type CommitmentOkKey,
} from "./flash";

// Commitment writes (spec 006, T174–T176). The layer between planned and spent:
// what a program has PROMISED. Three kinds of write live here and they are gated
// differently, which is the whole anti-fraud value of the feature:
//
//   RAISE a request  — director, admin or treasurer (COMMITMENT_CREATE_ROLES).
//                      The deliberate relaxation of today's treasurer-only money
//                      write, stated in 0021's header and in lib/treasury.
//   MOVE one         — treasurer only. Approve, issue, receive, close, cancel.
//   RESTATE one      — a revision INSERT, so the create roles again; the database
//                      additionally refuses a director restating an APPROVED
//                      commitment, because that would carry somebody else's
//                      approval onto an amount nobody re-approved.
//
// requester ≠ approver is a CHECK CONSTRAINT (0021), not a rule this file
// implements. What this file does is make sure the UI never implies otherwise
// and that the refusal, when it comes, reads as the point of the feature rather
// than as a bug.
//
// NOTHING HERE EDITS A COMMITMENT'S MONEY. The 0021 append-only trigger freezes
// amount, shipping, tax, vendor, purpose, budget line, need-by, funding source
// and kind at insert; a change is a REVISION ROW that supersedes the original,
// because "purchase orders are being altered after the fact" was the top finding
// in a real district audit and the auditor's rule is that a modification is a
// new document. The button may still say "Change amount".

function commitmentsPath(slug: string): string {
  // A redirect target is never built by interpolating a value the form posted:
  // `slug="/evil.com"` would produce "//evil.com/…", which every browser follows
  // off-site. programPath validates the slug and fails closed.
  return programPath(slug, "treasury/commitments") ?? "/";
}

// A failure that belongs to ONE commitment goes back to that commitment:
// `?edit=` reopens its panel and the page renders the message inside it. Which
// of the two sections it is, is the MAP's answer (flash.ts), not this file's.
function fail(
  slug: string,
  key: CommitmentErrorKey,
  id?: string,
  extra = "",
): string {
  const base = commitmentsPath(slug);
  if (isRowCommitmentError(key) && id) {
    const safe = encodeURIComponent(id);
    return `${base}?edit=${safe}&error=${key}${extra}#${commitmentAnchor(safe)}`;
  }
  return `${base}?error=${key}${extra}`;
}

function done(slug: string, key: CommitmentOkKey, extra = ""): string {
  return `${commitmentsPath(slug)}?ok=${key}${extra}`;
}

// 0021 raises a distinct SQLSTATE per outcome (class `OC`, its own header lists
// them), so the error CODE decides the sentence — never the message text, which
// lives in the UI and can be reworded without a migration.
const OC = {
  notInSeason: "OC016",
  frozenColumn: "OC020",
  stampRewrite: "OC021",
  bornApproved: "OC022",
  selfApproval: "OC023",
  notYourAct: "OC024",
  budgetLine: "OC025",
  reviseTarget: "OC026",
  reviseShape: "OC027",
  // The CHECK constraint behind self-approval fires as a plain check_violation,
  // because a constraint is the one layer no writer can route around — including
  // this one. Both codes therefore mean the same thing to a reader.
  checkViolation: "23514",
  denied: "42501",
} as const;

// `code` on a PostgREST error is the SQLSTATE verbatim. Own-property lookup, not
// `in`, for the same reason every error map in the app uses it: a code that
// arrives as "constructor" must resolve to nothing rather than walking up
// Object.prototype.
function codeMessage<T extends string>(
  map: Record<string, T>,
  error: { code?: string; message?: string } | null,
  fallback: T,
): T {
  const code = error?.code;
  return code && Object.hasOwn(map, code) ? map[code] : fallback;
}

function textOrNull(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

// A commitment's budget line reaches its season the long way — category →
// budget → budgets.season_id — so scoping it walks the chain explicitly. The
// 0021 insert trigger re-checks all of this; this layer exists to turn the
// rejection into a sentence a treasurer can act on instead of a 500.
async function resolveBudgetLineInSeason(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  seasonId: string,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const { data: lineRow } = await supabase
    .from("budget_lines")
    .select("id, category_id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  const line = lineRow as { id: string; category_id: string } | null;
  if (!line) return null;

  const { data: catRow } = await supabase
    .from("budget_categories")
    .select("budget_id")
    .eq("id", line.category_id)
    .eq("program_id", programId)
    .maybeSingle();
  const cat = catRow as { budget_id: string } | null;
  if (!cat) return null;

  const { data: budgetRow } = await supabase
    .from("budgets")
    .select("id")
    .eq("id", cat.budget_id)
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .maybeSingle();
  return budgetRow ? line.id : null;
}

// Everything a lifecycle move needs to know about the row it is moving, read in
// THIS program. Every id a form posts is resolved here before it is used for
// anything (Constitution I) — requireRole only proves the caller runs the
// program they CLAIMED.
interface CommitmentRowState extends CommitmentState {
  id: string;
  season_id: string;
  requested_by: string;
  budget_line_id: string;
}

async function readCommitment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  id: string,
): Promise<CommitmentRowState | null> {
  const { data } = await supabase
    .from("commitments")
    .select(
      "id, season_id, status, requested_by, budget_line_id, closed_at, cancelled_at, superseded_at",
    )
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return (data as CommitmentRowState | null) ?? null;
}

// ---------------------------------------------------------------------------
// Raise a request (T174 / T176)
// ---------------------------------------------------------------------------

export async function createCommitment(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  // Director, admin or treasurer — the relaxation, re-checked here on top of
  // RLS (Constitution I, defence in depth).
  const actor = await requireRole(programId, COMMITMENT_CREATE_ROLES);

  const kind = parseCommitmentKind(String(formData.get("kind") ?? ""));
  const fundingSource = parseFundingSource(
    String(formData.get("funding_source") ?? ""),
  );
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const shipping = parseDollarsToCents(String(formData.get("shipping") ?? "0")) ?? 0;
  const tax = parseDollarsToCents(String(formData.get("tax") ?? "0")) ?? 0;
  const vendor = textOrNull(formData.get("vendor"));
  const purpose = textOrNull(formData.get("purpose"));
  const needByRaw = String(formData.get("need_by") ?? "").trim();
  const needBy = /^\d{4}-\d{2}-\d{2}$/.test(needByRaw) ? needByRaw : null;

  if (!seasonId || !kind || !fundingSource || !vendor || !purpose) {
    redirect(fail(slug, "create"));
  }
  if (amount === null || amount <= 0) {
    redirect(fail(slug, "create_amount"));
  }

  const supabase = await createClient();

  // The season must be this program's. The budget line must be on THAT season's
  // budget — load-bearing, not optional: no line, no encumbrance, no math.
  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("id")
    .eq("id", seasonId)
    .eq("program_id", programId)
    .maybeSingle();
  if (!seasonRow) {
    redirect(fail(slug, "create_season"));
  }
  const budgetLineId = await resolveBudgetLineInSeason(
    supabase,
    programId,
    seasonId,
    textOrNull(formData.get("budget_line_id")),
  );
  if (!budgetLineId) {
    redirect(fail(slug, "create_line"));
  }

  const { error } = await supabase.from("commitments").insert({
    program_id: programId,
    season_id: seasonId,
    kind,
    funding_source: fundingSource,
    vendor,
    purpose,
    amount_cents: amount,
    shipping_cents: shipping,
    tax_cents: tax,
    budget_line_id: budgetLineId,
    need_by: needBy,
    // R6: after-the-fact commitments are ALLOWED and MARKED. Blocking them would
    // simply mean they never get recorded, and the count of them is the single
    // most valuable number on a board snapshot.
    after_the_fact: String(formData.get("after_the_fact") ?? "") === "1",
    external_ref: textOrNull(formData.get("external_ref")),
    note: textOrNull(formData.get("note")),
    // The trigger stamps this from auth.uid() regardless; sending it keeps the
    // NOT NULL satisfied on any path where it does not (a service-role import).
    requested_by: actor.user.id,
    // `number` is deliberately absent: it is assigned per program per funding
    // source by the database and never accepted from a form.
  });

  if (error) {
    redirect(
      fail(
        slug,
        codeMessage<CommitmentErrorKey>(
          {
            [OC.budgetLine]: "create_line",
            [OC.bornApproved]: "create",
            [OC.denied]: "create_denied",
          },
          error,
          "create",
        ),
      ),
    );
  }

  revalidatePath(commitmentsPath(slug));
  redirect(done(slug, "created"));
}

// ---------------------------------------------------------------------------
// The lifecycle (T175): approve → issue → receive → close, plus cancel
// ---------------------------------------------------------------------------
// One action for all of them, because they are one shape: check the seat, check
// the row is at a step where the move makes sense, write the status AND its
// stamp together (0021's CHECK constraints make those the same fact said twice),
// and let the engine be the backstop for anything a concurrent press slips past.

const OK_FOR_ACTION: Record<Exclude<CommitmentAction, "revise">, CommitmentOkKey> = {
  approve: "approved",
  issue: "issued",
  receive_partial: "received",
  receive_full: "received",
  close: "closed",
  cancel: "cancelled",
};

export async function moveCommitment(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const id = String(formData.get("commitmentId") ?? "");
  // Treasurer only. Money that has MOVED and money that is PROMISED are gated by
  // the same seat; only RAISING a request is wider.
  const actor = await requireRole(programId, TREASURY_WRITE_ROLES);

  const action = parseCommitmentAction(String(formData.get("act") ?? ""));
  if (!action || action === "revise" || !id) {
    redirect(fail(slug, "act", id));
  }

  const supabase = await createClient();
  const row = await readCommitment(supabase, programId, id);
  if (!row) {
    redirect(fail(slug, "act_missing", id));
  }
  if (!commitmentAllows(row, action)) {
    redirect(fail(slug, "act_state", id));
  }

  // THE POINT OF THE FEATURE, CHECKED BEFORE THE DATABASE CHECKS IT. The CHECK
  // constraint is the real control and cannot be routed around; this exists only
  // so the refusal reads as "you raised this one" rather than as a constraint
  // violation, and so the button that would produce it is never shown.
  if (action === "approve" && row.requested_by === actor.user.id) {
    redirect(fail(slug, "act_self", id));
  }

  const reason = textOrNull(formData.get("reason"));
  if ((action === "close" || action === "cancel") && !reason) {
    redirect(fail(slug, "act_reason", id));
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: COMMITMENT_ACTION_STATUS[action],
  };
  if (action === "approve") {
    patch.approved_by = actor.user.id;
    patch.approved_at = now;
  } else if (action === "issue") {
    patch.issued_at = now;
  } else if (action === "receive_full") {
    patch.received_by = actor.user.id;
    patch.received_at = now;
  } else if (action === "close") {
    patch.closed_at = now;
    patch.close_reason = reason;
    // R4: closing RELEASES THE REMAINDER, and the amount released is recorded.
    // Read in SQL (0022) rather than summed over fetched ledger rows — a
    // released amount is a money total, and this one is written down forever.
    // Unknown rather than zero when the read fails: `released_cents` is nullable
    // precisely so "we did not record it" is expressible, and a false $0.00 on a
    // closed purchase order is a permanent lie about where the money went.
    const { data: draw } = await supabase.rpc("commitment_drawdown_rows", {
      p_program_id: programId,
      p_season_id: row.season_id,
      p_commitment_ids: [id],
    });
    const first = Array.isArray(draw) ? draw[0] : null;
    const remaining =
      first && typeof first === "object"
        ? Number((first as Record<string, unknown>).remaining_cents)
        : NaN;
    patch.released_cents = Number.isFinite(remaining) ? remaining : null;
  } else if (action === "cancel") {
    patch.cancelled_at = now;
    patch.cancel_reason = reason;
  }

  const { error } = await supabase
    .from("commitments")
    .update(patch)
    .eq("id", id)
    .eq("program_id", programId);

  if (error) {
    redirect(
      fail(
        slug,
        codeMessage<CommitmentErrorKey>(
          {
            [OC.selfApproval]: "act_self",
            [OC.checkViolation]: "act_self",
            [OC.notYourAct]: "act_denied",
            [OC.denied]: "act_denied",
            [OC.stampRewrite]: "act_state",
            [OC.frozenColumn]: "act_state",
          },
          error,
          "act",
        ),
        id,
      ),
    );
  }

  revalidatePath(commitmentsPath(slug));
  // A closed or cancelled document drops out of the default (open-only) list, so
  // the treasurer would be told "Closed." about a row that just vanished. Land
  // on the full list with that row's panel open instead, where the amount it
  // released is written down.
  const extra =
    action === "close" || action === "cancel"
      ? `&all=1&edit=${encodeURIComponent(id)}#${commitmentAnchor(encodeURIComponent(id))}`
      : "";
  redirect(done(slug, OK_FOR_ACTION[action], extra));
}

// ---------------------------------------------------------------------------
// Restate one (T175 / R2) — "Change amount" writes a revision, never an edit
// ---------------------------------------------------------------------------
// The new row carries `revision_of_id`; 0021's audit trigger supersedes the
// original in the same transaction, so there is no window in which both stand
// and the committed total double-counts. The revision keeps the original's kind,
// funding source, season, vendor, purpose and budget line — a change to any of
// those is a different commitment, not a restatement of this one.

export async function reviseCommitment(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const id = String(formData.get("commitmentId") ?? "");
  // An INSERT, so the create roles — and 0021 refuses a non-treasurer restating
  // an APPROVED commitment on top of that.
  const actor = await requireRole(programId, COMMITMENT_CREATE_ROLES);

  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const shipping = parseDollarsToCents(String(formData.get("shipping") ?? "0")) ?? 0;
  const tax = parseDollarsToCents(String(formData.get("tax") ?? "0")) ?? 0;
  if (!id) {
    redirect(fail(slug, "revise"));
  }
  if (amount === null || amount <= 0) {
    redirect(fail(slug, "revise_amount", id));
  }

  const supabase = await createClient();
  const { data: parentRow } = await supabase
    .from("commitments")
    .select(
      "id, season_id, kind, funding_source, vendor, purpose, budget_line_id, need_by, after_the_fact, external_ref, status, closed_at, cancelled_at, superseded_at",
    )
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  const parent = parentRow as
    | (CommitmentState & {
        id: string;
        season_id: string;
        kind: string;
        funding_source: string;
        vendor: string;
        purpose: string;
        budget_line_id: string;
        need_by: string | null;
        after_the_fact: boolean;
        external_ref: string | null;
      })
    | null;
  if (!parent) {
    redirect(fail(slug, "act_missing", id));
  }
  if (!commitmentAllows(parent, "revise")) {
    redirect(fail(slug, "revise_state", id));
  }

  const needByRaw = String(formData.get("need_by") ?? "").trim();
  const needBy = /^\d{4}-\d{2}-\d{2}$/.test(needByRaw) ? needByRaw : parent.need_by;

  const { error } = await supabase.from("commitments").insert({
    program_id: programId,
    season_id: parent.season_id,
    kind: parent.kind,
    funding_source: parent.funding_source,
    vendor: parent.vendor,
    purpose: parent.purpose,
    amount_cents: amount,
    shipping_cents: shipping,
    tax_cents: tax,
    budget_line_id: parent.budget_line_id,
    need_by: needBy,
    after_the_fact: parent.after_the_fact,
    external_ref: parent.external_ref,
    note: textOrNull(formData.get("note")),
    revision_of_id: parent.id,
    requested_by: actor.user.id,
  });

  if (error) {
    redirect(
      fail(
        slug,
        codeMessage<CommitmentErrorKey>(
          {
            [OC.reviseTarget]: "revise_state",
            [OC.reviseShape]: "revise_shape",
            [OC.budgetLine]: "revise",
            [OC.denied]: "revise_denied",
          },
          error,
          "revise",
        ),
        id,
      ),
    );
  }

  revalidatePath(commitmentsPath(slug));
  redirect(done(slug, "revised"));
}

// ---------------------------------------------------------------------------
// The references a commitment collects afterwards
// ---------------------------------------------------------------------------
// The district's own PO number, a board-minutes reference, a note. These are
// ATTACHMENTS to the document, not the promise itself — 0021's append-only
// trigger leaves them editable on purpose and records every change in
// commitment_audit. Treasurer only, like every other UPDATE on the table.

export async function noteCommitment(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const id = String(formData.get("commitmentId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);
  if (!id) {
    redirect(fail(slug, "act"));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("commitments")
    .update({
      external_ref: textOrNull(formData.get("external_ref")),
      board_minutes_ref: textOrNull(formData.get("board_minutes_ref")),
      note: textOrNull(formData.get("note")),
    })
    .eq("id", id)
    .eq("program_id", programId);

  if (error) {
    redirect(
      fail(
        slug,
        codeMessage<CommitmentErrorKey>(
          {
            [OC.denied]: "act_denied",
            [OC.frozenColumn]: "act_state",
            [OC.notInSeason]: "act_missing",
          },
          error,
          "act",
        ),
        id,
      ),
    );
  }

  revalidatePath(commitmentsPath(slug));
  redirect(done(slug, "saved"));
}
