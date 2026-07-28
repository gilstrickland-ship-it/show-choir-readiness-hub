"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { programPath } from "@/lib/return-path";
import { zonedDateKey } from "@/lib/datetime";
import {
  TREASURY_WRITE_ROLES,
  parseLedgerDirection,
  parseDollarsToCents,
  firstOfMonth,
} from "@/lib/treasury";

// Ledger writes (T019). Entries void, never delete — a correction is a void
// plus a fresh entry ("Void & redo" in the UI, Constitution V). Only the
// treasurer writes; every action re-checks TREASURY_WRITE_ROLES via requireRole
// (defense in depth). ledger_audit rows are written on create and void (action,
// actor, diff jsonb).
//
// The 0002 void-only trigger makes every financial/content column immutable on
// UPDATE (including budget_line_id) and forbids un-voiding, so "put an
// uncategorized entry on a budget line" cannot be a plain UPDATE — it is
// implemented as a guided void + re-entry (see categorizeEntry).
//
// EVERY MONEY WRITE IS ONE DATABASE CALL (migration 0019). Void-then-insert as
// two PostgREST requests is not a transaction: when the second one failed, the
// original was already voided — permanently, since the trigger forbids
// un-voiding — and the amount silently left the balance with no way back. The
// same was true of the audit row, which was fired and forgotten while the UI
// said "Saved.", even though it is the only record of what a voided entry
// contained. add_ledger_entry / void_ledger_entry / categorize_ledger_entry each
// write the entry AND its audit row in one transaction: either the whole
// financial act happened or none of it did. Those functions re-assert the
// treasurer role, the program, the archived-season rule and the season of every
// tag on their own, so they are guards, not a way around RLS.

// A redirect target is never built by interpolating a value the form posted:
// `slug="/evil.com"` would produce "//evil.com/treasury", which every browser
// follows off-site. programPath validates the slug and fails closed.
function ledgerPath(slug: string): string {
  return programPath(slug, "treasury") ?? "/";
}

// A failure that belongs to ONE entry goes back to that entry: `?edit=` reopens
// its "Fix this entry" popover and the page renders the message inside it,
// rather than at the top of a ledger the treasurer may have to scroll to find
// the row again (the Wave-2 section-local error contract). The page falls the
// message back to a page-level banner when that row will not actually render —
// without an entry id there is no row to return to at all.
function rowErrorPath(slug: string, entryId: string, code: string): string {
  const base = ledgerPath(slug);
  if (!entryId) return `${base}?error=${code}`;
  const id = encodeURIComponent(entryId);
  return `${base}?edit=${id}&error=${code}#fix-${id}`;
}

// The 0020 money functions raise a distinct SQLSTATE per outcome, so the error
// code decides the sentence — never the message text, which lives in the UI.
// Class `OC` is ours (see 0020's header); an unmapped code falls through to the
// caller's generic message, which is what an app deployed ahead of the migration
// gets.
const OC = {
  notOurs: "OC001",
  alreadyFiled: "OC002",
  alreadyVoided: "OC003",
  amount: "OC010",
  season: "OC011",
  budgetLine: "OC012",
  competition: "OC013",
  trip: "OC014",
  noLine: "OC015",
} as const;

// `code` on a PostgREST error is the SQLSTATE verbatim. Own-property lookup, not
// `in`, for the same reason every error map in the app uses it.
function codeMessage(
  map: Record<string, string>,
  error: { code?: string } | null,
  fallback: string,
): string {
  const code = error?.code;
  return code && Object.hasOwn(map, code) ? map[code] : fallback;
}

function textOrNull(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "receipt";
}

// A ledger entry carries four references — its season plus up to three optional
// tags (budget line, competition, trip). All four arrive as form fields, and
// requireRole only proves the caller runs the program they CLAIMED. Resolve each
// inside this program AND inside the entry's season before the row is written
// (Constitution I): a tag pointing at another program's row is invisible to
// them, un-deletable by them, and made permanent by the void-only trigger; a tag
// pointing at a PREVIOUS season's row is a real row of theirs booked onto the
// wrong year's books, and is frozen there just as permanently.
//
// Returns the id when it is ours and in-season, null when the field was blank,
// false when it is neither — a miss is an error, never a silently dropped tag,
// because a dropped tag is a money-attribution bug (Constitution V). The DB
// functions re-check all of this; this layer exists to turn a rejection into a
// sentence a treasurer can act on instead of a 500.
async function programOwns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  programId: string,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  return !!(data as { id: string } | null);
}

// A tag on a table that carries season_id directly (competitions, trips).
async function resolveSeasonScopedId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  programId: string,
  seasonId: string,
  id: string | null,
): Promise<string | null | false> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? false;
}

// A budget line reaches its season the long way — category → budget →
// budgets.season_id — so scoping it walks the chain explicitly. Three small
// keyed lookups, and only when a line was actually picked.
async function resolveBudgetLineInSeason(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  seasonId: string,
  id: string | null,
): Promise<string | null | false> {
  if (!id) return null;
  const { data: lineRow } = await supabase
    .from("budget_lines")
    .select("id, category_id")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  const line = lineRow as { id: string; category_id: string } | null;
  if (!line) return false;

  const { data: catRow } = await supabase
    .from("budget_categories")
    .select("budget_id")
    .eq("id", line.category_id)
    .eq("program_id", programId)
    .maybeSingle();
  const cat = catRow as { budget_id: string } | null;
  if (!cat) return false;

  const { data: budgetRow } = await supabase
    .from("budgets")
    .select("id")
    .eq("id", cat.budget_id)
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .maybeSingle();
  return budgetRow ? line.id : false;
}

const RECEIPT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Optional receipt upload to the 'receipts' bucket, namespaced by program_id
// (storage RLS keys on the first path segment). Returns the stored path, null
// when no file was attached, or throws-via-redirect on a bad type/upload.
async function uploadReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  slug: string,
  file: FormDataEntryValue | null,
): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!RECEIPT_TYPES.has(file.type)) {
    redirect(`${ledgerPath(slug)}?error=receipt_type`);
  }
  const path = `${programId}/${Date.now()}-${sanitizeName(file.name)}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) {
    redirect(`${ledgerPath(slug)}?error=receipt_upload`);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Add entry
// ---------------------------------------------------------------------------

export async function addEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const direction = parseLedgerDirection(String(formData.get("direction") ?? ""));
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const postedDate = String(formData.get("entry_date") ?? "").trim();

  if (!seasonId || !direction || amount === null || amount <= 0) {
    redirect(`${ledgerPath(slug)}?error=entry`);
  }

  const supabase = await createClient();

  // The date lives behind the "Connect it" disclosure, so it must not be a
  // required field: a required input inside a collapsed <details> cannot be
  // focused, and the browser silently refuses to submit the whole form. Blank
  // means today — on the PROGRAM's calendar, not the server's, or a 7pm entry
  // in Chicago is dated tomorrow by a UTC host (Constitution VII).
  let entryDate = /^\d{4}-\d{2}-\d{2}$/.test(postedDate) ? postedDate : "";
  if (!entryDate) {
    const { data: prog } = await supabase
      .from("programs")
      .select("timezone")
      .eq("id", programId)
      .maybeSingle();
    const tz = (prog as { timezone: string } | null)?.timezone;
    if (!tz) {
      redirect(`${ledgerPath(slug)}?error=entry`);
    }
    entryDate = zonedDateKey(new Date(), tz);
  }

  // Resolve the season and all three tags before uploading anything, so a bad
  // reference never leaves a stranded receipt object behind.
  const [season, budgetLineId, competitionId, tripId] = await Promise.all([
    programOwns(supabase, "seasons", programId, seasonId),
    resolveBudgetLineInSeason(
      supabase,
      programId,
      seasonId,
      textOrNull(formData.get("budget_line_id")),
    ),
    resolveSeasonScopedId(
      supabase,
      "competitions",
      programId,
      seasonId,
      textOrNull(formData.get("competition_id")),
    ),
    resolveSeasonScopedId(
      supabase,
      "trips",
      programId,
      seasonId,
      textOrNull(formData.get("trip_id")),
    ),
  ]);
  if (!season) {
    redirect(`${ledgerPath(slug)}?error=entry`);
  }
  if (budgetLineId === false || competitionId === false || tripId === false) {
    redirect(`${ledgerPath(slug)}?error=entry_tag`);
  }

  // Tracked separately from `receiptPath` because only an object THIS request
  // uploaded may be cleaned up on failure — the redo path below carries a prior
  // entry's receipt forward, and deleting that would destroy the proof behind a
  // row that is still on the books.
  const uploadedPath = await uploadReceipt(
    supabase,
    programId,
    slug,
    formData.get("receipt"),
  );
  let receiptPath = uploadedPath;

  // "Void & redo" carries the original's receipt forward. A file input cannot be
  // prefilled, so without this the redo silently dropped the only proof the
  // money was spent the way the memo says. The PATH is never taken from the
  // form — only the id of the entry being redone, re-read in this program.
  if (!receiptPath) {
    const redoOf = textOrNull(formData.get("redo_of"));
    if (redoOf) {
      const { data: prior } = await supabase
        .from("ledger_entries")
        .select("receipt_path")
        .eq("id", redoOf)
        .eq("program_id", programId)
        .maybeSingle();
      receiptPath = (prior as { receipt_path: string | null } | null)?.receipt_path ?? null;
    }
  }

  // One call = one transaction: the entry and its 'create' audit row land
  // together or not at all.
  const { data: newId, error } = await supabase.rpc("add_ledger_entry", {
    p_program_id: programId,
    p_season_id: seasonId,
    p_entry_date: entryDate,
    p_direction: direction,
    p_amount_cents: amount,
    p_budget_line_id: budgetLineId,
    p_competition_id: competitionId,
    p_trip_id: tripId,
    p_memo: textOrNull(formData.get("memo")),
    p_counterparty: textOrNull(formData.get("counterparty")),
    p_receipt_path: receiptPath,
  });

  if (error || !newId) {
    // The receipt reached storage before the entry reached the ledger, so a
    // refused write used to strand the object: it is in the bucket forever,
    // attached to nothing, and the treasurer has to upload it again on the
    // retry. Take it back out before reporting the failure.
    if (uploadedPath) {
      await supabase.storage.from("receipts").remove([uploadedPath]);
    }
    // Every rejection used to read as advice about the amount format, including
    // "that competition is from last season". One code, one sentence (0020).
    redirect(
      `${ledgerPath(slug)}?error=${codeMessage(
        {
          [OC.amount]: "entry",
          [OC.season]: "entry_season",
          [OC.budgetLine]: "entry_line",
          [OC.competition]: "entry_competition",
          [OC.trip]: "entry_trip",
        },
        error,
        "entry",
      )}`,
    );
  }
  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Void (reason required). Optionally bounce to the add-entry drawer prefilled
// from the just-voided entry ("Void & redo").
// ---------------------------------------------------------------------------

export async function voidEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const reenter = String(formData.get("reenter") ?? "") === "1";
  await requireRole(programId, TREASURY_WRITE_ROLES);

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    redirect(rowErrorPath(slug, entryId, "void_reason"));
  }

  const supabase = await createClient();
  // 0020 raises rather than returning `false`, and the two no-ops it used to
  // share that value between — "not this program's entry" and "already voided"
  // — are different things to say. The function writes nothing in either case,
  // so no audit row is ever created for a void that did not happen.
  const { data: voided, error } = await supabase.rpc("void_ledger_entry", {
    p_entry_id: entryId,
    p_program_id: programId,
    p_reason: reason,
  });
  if (error || voided !== true) {
    redirect(
      rowErrorPath(
        slug,
        entryId,
        codeMessage(
          {
            [OC.notOurs]: "void_missing",
            [OC.alreadyVoided]: "void_already",
            [OC.season]: "void_archived",
          },
          error,
          "void",
        ),
      ),
    );
  }

  revalidatePath(ledgerPath(slug));
  if (reenter) {
    // Prefill a fresh entry from the voided one (§7 "void & redo").
    redirect(
      `${ledgerPath(slug)}?reenter=${encodeURIComponent(entryId)}#add-entry`,
    );
  }
  redirect(`${ledgerPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Monthly reconciliation (Wave L). Marking a month reconciled asserts the ledger
// was compared to the bank statement and matched — a status record, not money.
// Treasurer only (requireRole, defense in depth on top of RLS). Un-marking is a
// delete (a reconciliation is reversible, unlike a ledger entry). No update path:
// re-marking after an un-mark just re-inserts. `monthKey` is a "YYYY-MM" bucket;
// the row stores the first-of-month date and unique(program_id, month) makes a
// duplicate mark a benign no-op.
// ---------------------------------------------------------------------------

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function markReconciled(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const monthKey = String(formData.get("month") ?? "").trim();
  const actor = await requireRole(programId, TREASURY_WRITE_ROLES);

  if (!MONTH_KEY_RE.test(monthKey)) {
    redirect(`${ledgerPath(slug)}?error=reconcile`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ledger_reconciliations").insert({
    program_id: programId,
    month: firstOfMonth(monthKey),
    note: textOrNull(formData.get("note")),
    reconciled_by: actor.user.id,
  });
  // A duplicate (already reconciled) is a benign no-op, not an error surface.
  if (error && error.code !== "23505") {
    redirect(`${ledgerPath(slug)}?error=reconcile`);
  }

  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}

export async function unmarkReconciled(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const monthKey = String(formData.get("month") ?? "").trim();
  await requireRole(programId, TREASURY_WRITE_ROLES);

  if (!MONTH_KEY_RE.test(monthKey)) {
    redirect(`${ledgerPath(slug)}?error=reconcile`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ledger_reconciliations")
    .delete()
    .eq("program_id", programId)
    .eq("month", firstOfMonth(monthKey));
  if (error) {
    redirect(`${ledgerPath(slug)}?error=reconcile`);
  }

  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Putting an uncategorized entry on a budget line = a guided void + re-entry
// with the line set. The void-only trigger blocks a plain budget_line_id UPDATE,
// so this is the correct path (see module header). Both halves — and both audit
// rows — are one transaction inside categorize_ledger_entry, which is the whole
// point: a half-completed filing would void real money out of the balance with
// no replacement and no way to undo it.
// ---------------------------------------------------------------------------

export async function categorizeEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const budgetLineId = textOrNull(formData.get("budget_line_id"));
  await requireRole(programId, TREASURY_WRITE_ROLES);

  if (!budgetLineId || !entryId) {
    redirect(rowErrorPath(slug, entryId, "categorize"));
  }

  const supabase = await createClient();
  const { data: newId, error } = await supabase.rpc("categorize_ledger_entry", {
    p_entry_id: entryId,
    p_program_id: programId,
    p_budget_line_id: budgetLineId,
  });

  if (error || !newId) {
    // "Nothing changed — the entry is still there, uncategorized" was the ONE
    // message for every outcome here, including a double submit of a filing
    // that had already worked. 0020 tells them apart (see its header): the
    // second press now says the entry is filed, because it is.
    redirect(
      rowErrorPath(
        slug,
        entryId,
        codeMessage(
          {
            [OC.notOurs]: "categorize_missing",
            [OC.alreadyFiled]: "categorize_already",
            [OC.alreadyVoided]: "categorize_voided",
            [OC.season]: "categorize_archived",
            [OC.budgetLine]: "categorize_line",
            [OC.noLine]: "categorize",
          },
          error,
          "categorize",
        ),
      ),
    );
  }

  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}
