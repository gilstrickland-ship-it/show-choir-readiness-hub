"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type Membership } from "@/lib/auth";
import type { User } from "@supabase/supabase-js";
import {
  TREASURY_WRITE_ROLES,
  parseLedgerDirection,
  parseDollarsToCents,
  firstOfMonth,
  type LedgerDirection,
} from "@/lib/treasury";

// Ledger writes (T019). Entries void, never delete — corrections are void +
// re-enter (Constitution V). Only the treasurer writes; every action re-checks
// TREASURY_WRITE_ROLES via requireRole (defense in depth). ledger_audit rows are
// written on create and void (action, actor, diff jsonb).
//
// The 0002 void-only trigger makes every financial/content column immutable on
// UPDATE (including budget_line_id) and forbids un-voiding, so "categorize an
// uncategorized entry" cannot be a plain UPDATE — it is implemented as guided
// void + re-enter (see categorizeEntry).

function ledgerPath(slug: string): string {
  return `/${slug}/treasury`;
}

function textOrNull(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "receipt";
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

// Insert an entry and its 'create' audit row. Shared by addEntry and the
// re-enter half of categorizeEntry. Returns the new entry id.
async function insertEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: { user: User; membership: Membership },
  row: {
    program_id: string;
    season_id: string;
    entry_date: string;
    direction: LedgerDirection;
    amount_cents: number;
    budget_line_id: string | null;
    competition_id: string | null;
    trip_id: string | null;
    memo: string | null;
    counterparty: string | null;
    receipt_path: string | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ledger_entries")
    .insert({ ...row, entered_by: actor.user.id })
    .select("id")
    .single();
  if (error || !data) return null;

  await supabase.from("ledger_audit").insert({
    program_id: row.program_id,
    entry_id: data.id,
    action: "create",
    actor: actor.user.id,
    diff: {
      direction: row.direction,
      amount_cents: row.amount_cents,
      entry_date: row.entry_date,
      budget_line_id: row.budget_line_id,
      competition_id: row.competition_id,
      trip_id: row.trip_id,
      memo: row.memo,
      counterparty: row.counterparty,
    },
  });
  return data.id;
}

// Void an entry (set voided_at/voided_by/void_reason — the only mutation the
// trigger permits) and write its 'void' audit row.
async function voidEntryRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: { user: User },
  programId: string,
  entryId: string,
  reason: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("ledger_entries")
    .update({
      voided_at: new Date().toISOString(),
      voided_by: actor.user.id,
      void_reason: reason,
    })
    .eq("id", entryId)
    .eq("program_id", programId)
    .is("voided_at", null); // never touch an already-voided row
  if (error) return false;

  await supabase.from("ledger_audit").insert({
    program_id: programId,
    entry_id: entryId,
    action: "void",
    actor: actor.user.id,
    diff: { void_reason: reason },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Add entry
// ---------------------------------------------------------------------------

export async function addEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const actor = await requireRole(programId, TREASURY_WRITE_ROLES);

  const direction = parseLedgerDirection(String(formData.get("direction") ?? ""));
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const entryDate = String(formData.get("entry_date") ?? "").trim();

  if (!seasonId || !direction || amount === null || amount <= 0 || !entryDate) {
    redirect(`${ledgerPath(slug)}?error=entry`);
  }

  const supabase = await createClient();
  const receiptPath = await uploadReceipt(
    supabase,
    programId,
    slug,
    formData.get("receipt"),
  );

  const id = await insertEntry(supabase, actor, {
    program_id: programId,
    season_id: seasonId,
    entry_date: entryDate,
    direction: direction as LedgerDirection,
    amount_cents: amount as number,
    budget_line_id: textOrNull(formData.get("budget_line_id")),
    competition_id: textOrNull(formData.get("competition_id")),
    trip_id: textOrNull(formData.get("trip_id")),
    memo: textOrNull(formData.get("memo")),
    counterparty: textOrNull(formData.get("counterparty")),
    receipt_path: receiptPath,
  });

  if (!id) {
    redirect(`${ledgerPath(slug)}?error=entry`);
  }
  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}

// ---------------------------------------------------------------------------
// Void (reason required). Optionally bounce to the re-enter form prefilled from
// the just-voided entry ("void & re-enter").
// ---------------------------------------------------------------------------

export async function voidEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const reenter = String(formData.get("reenter") ?? "") === "1";
  const actor = await requireRole(programId, TREASURY_WRITE_ROLES);

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    redirect(`${ledgerPath(slug)}?error=void_reason`);
  }

  const supabase = await createClient();
  const ok = await voidEntryRow(supabase, actor, programId, entryId, reason);
  if (!ok) {
    redirect(`${ledgerPath(slug)}?error=void`);
  }

  revalidatePath(ledgerPath(slug));
  if (reenter) {
    // Prefill a fresh entry from the voided one (§7 "void & re-enter").
    redirect(`${ledgerPath(slug)}?reenter=${entryId}#add-entry`);
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
// Categorize an uncategorized entry = guided void + re-enter with the budget
// line set. The void-only trigger blocks a plain budget_line_id UPDATE, so this
// is the correct path (see module header). Both halves are audited.
// ---------------------------------------------------------------------------

export async function categorizeEntry(formData: FormData): Promise<void> {
  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const budgetLineId = textOrNull(formData.get("budget_line_id"));
  const actor = await requireRole(programId, TREASURY_WRITE_ROLES);

  if (!budgetLineId) {
    redirect(`${ledgerPath(slug)}?error=categorize`);
  }

  const supabase = await createClient();

  // Read the original (must be live and uncategorized).
  const { data: orig } = await supabase
    .from("ledger_entries")
    .select(
      "season_id, entry_date, direction, amount_cents, competition_id, trip_id, memo, counterparty, receipt_path, budget_line_id, voided_at",
    )
    .eq("id", entryId)
    .eq("program_id", programId)
    .maybeSingle();

  if (!orig || orig.voided_at || orig.budget_line_id) {
    redirect(`${ledgerPath(slug)}?error=categorize`);
  }

  // Void the original, then re-enter it verbatim with the line attached.
  const ok = await voidEntryRow(
    supabase,
    actor,
    programId,
    entryId,
    "Recategorized to a budget line (void + re-enter)",
  );
  if (!ok) {
    redirect(`${ledgerPath(slug)}?error=categorize`);
  }

  const id = await insertEntry(supabase, actor, {
    program_id: programId,
    season_id: orig.season_id,
    entry_date: orig.entry_date,
    direction: orig.direction,
    amount_cents: orig.amount_cents,
    budget_line_id: budgetLineId,
    competition_id: orig.competition_id,
    trip_id: orig.trip_id,
    memo: orig.memo,
    counterparty: orig.counterparty,
    receipt_path: orig.receipt_path,
  });
  if (!id) {
    redirect(`${ledgerPath(slug)}?error=categorize`);
  }

  revalidatePath(ledgerPath(slug));
  redirect(`${ledgerPath(slug)}?saved=1`);
}
