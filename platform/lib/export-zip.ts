import JSZip from "jszip";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { csvFile, type CsvFile } from "@/lib/export";
import {
  loadTripDoc,
  loadPacketData,
  loadBoardSnapshot,
  loadMealData,
} from "@/lib/pdf/queries";
import {
  BusManifest,
  RoomSheet,
  ParentPacket,
  BoardSnapshot,
  MealCount,
} from "@/lib/pdf/documents";
import { activeCaptions } from "@/lib/competitions";

// Shared export-all builder (§13.2, T029/T036). ONE implementation of "everything
// as a zip", used by BOTH the synchronous download route (dev fallback) and the
// async Inngest `export/all` job. Every query is scoped by program_id, so it is
// correct whether it runs on the caller's RLS client (sync download) or the
// service-role client (async job). Node runtime only (React-PDF).
//
// The anti-lock-in trust answer: a real "export everything" button — CSVs of the
// full program plus every generated PDF (published packets, meal counts, bus +
// room sheets, board snapshots), not a promise.

async function pdfBuffer(element: ReactElement): Promise<Uint8Array> {
  const buffer = await renderToBuffer(element as ReactElement<DocumentProps>);
  return new Uint8Array(buffer);
}

// Build the full export zip for one program. Returns the zip bytes; the caller
// sets the filename / Content-Disposition (sync) or storage path (async).
export async function buildExportZip(
  supabase: SupabaseClient,
  programId: string,
): Promise<Uint8Array> {
  // ---- Lookups for readable CSVs --------------------------------------------
  const [
    { data: seasonsD },
    { data: ensemblesD },
    { data: studentsD },
    { data: compsD },
  ] = await Promise.all([
    supabase.from("seasons").select("id, label").eq("program_id", programId),
    supabase.from("ensembles").select("id, name").eq("program_id", programId),
    supabase.from("students").select("id, first_name, last_name").eq("program_id", programId),
    supabase.from("competitions").select("id, name, date, season_id").eq("program_id", programId),
  ]);
  const seasonLabel = new Map(
    ((seasonsD as { id: string; label: string }[] | null) ?? []).map((s) => [s.id, s.label]),
  );
  const ensembleName = new Map(
    ((ensemblesD as { id: string; name: string }[] | null) ?? []).map((e) => [e.id, e.name]),
  );
  const studentName = new Map(
    ((studentsD as { id: string; first_name: string; last_name: string }[] | null) ?? []).map(
      (s) => [s.id, `${s.last_name}, ${s.first_name}`],
    ),
  );
  const compName = new Map(
    ((compsD as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]),
  );

  const files: CsvFile[] = [];

  // ---- students.csv ---------------------------------------------------------
  {
    const { data } = await supabase
      .from("students")
      .select("id, first_name, last_name, grad_year, status, sizes")
      .eq("program_id", programId)
      .order("last_name", { ascending: true });
    const rows = ((data as
      | { id: string; first_name: string; last_name: string; grad_year: number | null; status: string; sizes: unknown }[]
      | null) ?? []).map((s) => [
      s.id,
      s.first_name,
      s.last_name,
      s.grad_year,
      s.status,
      s.sizes,
    ]);
    files.push(
      csvFile("students.csv", ["id", "first_name", "last_name", "grad_year", "status", "sizes"], rows),
    );
  }

  // ---- guardians.csv --------------------------------------------------------
  {
    const { data } = await supabase
      .from("guardians")
      .select("id, student_id, name, email, phone, relationship, email_status")
      .eq("program_id", programId);
    const rows = ((data as
      | { id: string; student_id: string; name: string; email: string | null; phone: string | null; relationship: string | null; email_status: string }[]
      | null) ?? []).map((g) => [
      g.id,
      studentName.get(g.student_id) ?? g.student_id,
      g.name,
      g.email,
      g.phone,
      g.relationship,
      g.email_status,
    ]);
    files.push(
      csvFile(
        "guardians.csv",
        ["id", "student", "name", "email", "phone", "relationship", "email_status"],
        rows,
      ),
    );
  }

  // ---- ensemble_members.csv -------------------------------------------------
  {
    const { data } = await supabase
      .from("ensemble_members")
      .select("season_id, ensemble_id, student_id, role, voice_part")
      .eq("program_id", programId);
    const rows = ((data as
      | { season_id: string; ensemble_id: string; student_id: string; role: string; voice_part: string | null }[]
      | null) ?? []).map((m) => [
      seasonLabel.get(m.season_id) ?? m.season_id,
      ensembleName.get(m.ensemble_id) ?? m.ensemble_id,
      studentName.get(m.student_id) ?? m.student_id,
      m.role,
      m.voice_part,
    ]);
    files.push(
      csvFile("ensemble_members.csv", ["season", "ensemble", "student", "role", "voice_part"], rows),
    );
  }

  // ---- attendance.csv -------------------------------------------------------
  {
    const { data } = await supabase
      .from("attendance")
      .select("competition_id, student_id, status, note")
      .eq("program_id", programId);
    const rows = ((data as
      | { competition_id: string; student_id: string; status: string; note: string | null }[]
      | null) ?? []).map((a) => [
      compName.get(a.competition_id) ?? a.competition_id,
      studentName.get(a.student_id) ?? a.student_id,
      a.status,
      a.note,
    ]);
    files.push(csvFile("attendance.csv", ["competition", "student", "status", "note"], rows));
  }

  // ---- costume_pieces.csv ---------------------------------------------------
  {
    const { data } = await supabase
      .from("costume_pieces")
      .select("id, label, kind, size_label, color, condition, storage_location")
      .eq("program_id", programId);
    const rows = ((data as
      | { id: string; label: string; kind: string; size_label: string | null; color: string | null; condition: string; storage_location: string | null }[]
      | null) ?? []).map((p) => [
      p.id,
      p.label,
      p.kind,
      p.size_label,
      p.color,
      p.condition,
      p.storage_location,
    ]);
    files.push(
      csvFile(
        "costume_pieces.csv",
        ["id", "label", "kind", "size_label", "color", "condition", "storage_location"],
        rows,
      ),
    );
  }

  // ---- costume_assignments.csv ----------------------------------------------
  {
    const { data } = await supabase
      .from("costume_assignments")
      .select("season_id, piece_id, student_id, alteration_status, alteration_notes, piece:costume_pieces(label)")
      .eq("program_id", programId);
    const rows = ((data as
      | { season_id: string; piece_id: string; student_id: string; alteration_status: string; alteration_notes: string | null; piece: { label: string } | null }[]
      | null) ?? []).map((a) => [
      seasonLabel.get(a.season_id) ?? a.season_id,
      a.piece?.label ?? a.piece_id,
      studentName.get(a.student_id) ?? a.student_id,
      a.alteration_status,
      a.alteration_notes,
    ]);
    files.push(
      csvFile(
        "costume_assignments.csv",
        ["season", "piece", "student", "alteration_status", "alteration_notes"],
        rows,
      ),
    );
  }

  // ---- ledger_entries.csv ---------------------------------------------------
  {
    const { data } = await supabase
      .from("ledger_entries")
      .select("entry_date, direction, amount_cents, budget_line_id, competition_id, trip_id, memo, counterparty, voided_at, void_reason")
      .eq("program_id", programId)
      .order("entry_date", { ascending: true });
    const rows = ((data as
      | { entry_date: string; direction: string; amount_cents: number; budget_line_id: string | null; competition_id: string | null; trip_id: string | null; memo: string | null; counterparty: string | null; voided_at: string | null; void_reason: string | null }[]
      | null) ?? []).map((e) => [
      e.entry_date,
      e.direction,
      e.amount_cents,
      e.budget_line_id,
      e.competition_id ? (compName.get(e.competition_id) ?? e.competition_id) : "",
      e.trip_id,
      e.memo,
      e.counterparty,
      e.voided_at,
      e.void_reason,
    ]);
    files.push(
      csvFile(
        "ledger_entries.csv",
        ["entry_date", "direction", "amount_cents", "budget_line_id", "competition", "trip_id", "memo", "counterparty", "voided_at", "void_reason"],
        rows,
      ),
    );
  }

  // ---- budget_lines.csv -----------------------------------------------------
  {
    const { data } = await supabase
      .from("budget_lines")
      .select("name, planned_cents, category:budget_categories(name, direction, budget:budgets(name, season_id))")
      .eq("program_id", programId);
    const rows = ((data as
      | { name: string; planned_cents: number; category: { name: string; direction: string; budget: { name: string; season_id: string } | null } | null }[]
      | null) ?? []).map((l) => [
      l.category?.budget ? (seasonLabel.get(l.category.budget.season_id) ?? "") : "",
      l.category?.budget?.name ?? "",
      l.category?.name ?? "",
      l.category?.direction ?? "",
      l.name,
      l.planned_cents,
    ]);
    files.push(
      csvFile(
        "budget_lines.csv",
        ["season", "budget", "category", "direction", "line", "planned_cents"],
        rows,
      ),
    );
  }

  // ---- competition_results.csv ----------------------------------------------
  {
    const { data } = await supabase
      .from("competition_results")
      .select("competition_id, placement, division, score, captions, notes")
      .eq("program_id", programId);
    const rows = ((data as
      | { competition_id: string; placement: string | null; division: string | null; score: number | null; captions: Record<string, unknown> | null; notes: string | null }[]
      | null) ?? []).map((r) => [
      compName.get(r.competition_id) ?? r.competition_id,
      r.placement,
      r.division,
      r.score,
      activeCaptions(r.captions).join("; "),
      r.notes,
    ]);
    files.push(
      csvFile(
        "competition_results.csv",
        ["competition", "placement", "division", "score", "captions", "notes"],
        rows,
      ),
    );
  }

  // ---- Assemble the zip -----------------------------------------------------
  const zip = new JSZip();
  const csvDir = zip.folder("csv");
  for (const f of files) csvDir?.file(f.name, f.content);

  const pdfDir = zip.folder("pdf");

  // Board snapshot per season.
  for (const s of (seasonsD as { id: string; label: string }[] | null) ?? []) {
    try {
      const data = await loadBoardSnapshot(supabase, s.id);
      if (data) {
        const buf = await pdfBuffer(createElement(BoardSnapshot, { data }));
        pdfDir?.file(`board-snapshot-${s.label.replace(/[^\w-]+/g, "_")}.pdf`, buf);
      }
    } catch {
      // Skip a failed render — a partial export beats no export.
    }
  }

  // Parent packet per competition with a PUBLISHED itinerary.
  {
    const { data: pubItins } = await supabase
      .from("itineraries")
      .select("competition_id, status")
      .eq("program_id", programId)
      .eq("status", "published");
    for (const it of (pubItins as { competition_id: string }[] | null) ?? []) {
      try {
        const data = await loadPacketData(supabase, it.competition_id);
        if (data && data.itineraryPublished) {
          const buf = await pdfBuffer(createElement(ParentPacket, { data }));
          const nm = (compName.get(it.competition_id) ?? it.competition_id).replace(/[^\w-]+/g, "_");
          pdfDir?.file(`packet-${nm}.pdf`, buf);
        }
      } catch {
        // skip
      }
    }
  }

  // Meal count per competition (T031).
  for (const c of (compsD as { id: string; name: string }[] | null) ?? []) {
    try {
      const data = await loadMealData(supabase, c.id);
      if (data && (data.totalAttending > 0 || data.totalAbsent > 0)) {
        const buf = await pdfBuffer(createElement(MealCount, { data }));
        const nm = (compName.get(c.id) ?? c.id).replace(/[^\w-]+/g, "_");
        pdfDir?.file(`meal-count-${nm}.pdf`, buf);
      }
    } catch {
      // skip
    }
  }

  // Bus manifest + room sheet per trip.
  {
    const { data: tripsD } = await supabase
      .from("trips")
      .select("id, name")
      .eq("program_id", programId);
    for (const t of (tripsD as { id: string; name: string }[] | null) ?? []) {
      try {
        const data = await loadTripDoc(supabase, t.id);
        if (data) {
          const nm = t.name.replace(/[^\w-]+/g, "_");
          const bus = await pdfBuffer(createElement(BusManifest, { data }));
          pdfDir?.file(`bus-manifest-${nm}.pdf`, bus);
          const room = await pdfBuffer(createElement(RoomSheet, { data, variant: "default" }));
          pdfDir?.file(`room-sheet-${nm}.pdf`, room);
        }
      } catch {
        // skip
      }
    }
  }

  return await zip.generateAsync({ type: "uint8array" });
}
