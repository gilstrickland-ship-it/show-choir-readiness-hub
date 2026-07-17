// ============================================================================
// Octv Platform — Combined roster CSV import (T008)
// ----------------------------------------------------------------------------
// Pure, DB-free parsing for the "one spreadsheet the director already has":
// students + multiple guardians in a single file. No product name, no I/O, no
// Supabase — everything here is deterministic and unit-tested (tests/unit).
//
// Constitution III (data minimization): health/medical columns are detected by
// header keyword and excluded ENTIRELY — never parsed into a preview row, never
// committed. They surface only as a `skippedColumns` notice so the director sees
// the product refused them.
//
// Multi-guardian is supported in BOTH spreadsheet shapes:
//   * repeated column groups — guardian2_name, "Guardian 2 Email", …
//   * repeated rows — the same student name + grad year on consecutive rows
//     merges its guardian into the student already being built.
// ============================================================================

export const DEFAULT_SIZE_KEYS: readonly string[] = ["top", "bottom", "shoe"];

// Header keywords that mark a column as sensitive-PII and get it dropped whole.
// Substring, case-insensitive. Kept deliberately broad (Constitution III).
export const HEALTH_HEADER_KEYWORDS: readonly string[] = [
  "medical",
  "health",
  "allerg",
  "diet",
  "epipen",
  "medication",
  "condition",
  "emergency",
  "dob",
  "birth",
  "address",
];

export interface ParsedGuardian {
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
}

export interface ParsedStudent {
  /** Source data-row numbers (1-based, header excluded) that built this student. */
  sourceRows: number[];
  firstName: string;
  lastName: string;
  gradYear: number | null;
  sizes: Record<string, string>;
  guardians: ParsedGuardian[];
  /** How many continuation rows merged extra guardians into this student. */
  mergedRowCount: number;
}

export interface RowError {
  /** 1-based data-row number (header excluded). */
  row: number;
  message: string;
}

export interface SkippedColumn {
  header: string;
  reason: string;
}

export interface ParseResult {
  rows: ParsedStudent[];
  errors: RowError[];
  skippedColumns: SkippedColumn[];
}

// ----------------------------------------------------------------------------
// Column mapping
// ----------------------------------------------------------------------------

type ColumnMap =
  | { type: "first" }
  | { type: "last" }
  | { type: "name_combined" }
  | { type: "grad" }
  | { type: "size"; key: string }
  | { type: "guardian"; index: number; field: keyof ParsedGuardian }
  | { type: "health" }
  | { type: "unknown" };

/** lowercase, collapse all non-alphanumerics — "Guardian 2 E-mail" → "guardian2email". */
function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Extract the first run of digits, e.g. "guardian2email" → 2; none → 1. */
function guardianIndex(n: string): number {
  const m = n.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

function isHealthHeader(header: string): boolean {
  const lower = header.toLowerCase();
  return HEALTH_HEADER_KEYWORDS.some((kw) => lower.includes(kw));
}

function mapSizeColumn(n: string, sizeKeys: readonly string[]): ColumnMap | null {
  for (const key of sizeKeys) {
    const k = norm(key);
    if (!k) continue;
    if (n === k || n === `${k}size` || n === `size${k}`) {
      return { type: "size", key };
    }
  }
  return null;
}

function mapGuardianField(n: string): keyof ParsedGuardian | null {
  // relationship BEFORE name/email so "guardianrelationship" isn't caught as name.
  if (n.includes("relation") || n.includes("relationship")) return "relationship";
  if (n.includes("email") || n.includes("mail")) return "email";
  if (n.includes("phone") || n.includes("cell") || n.includes("mobile") || n.includes("tel"))
    return "phone";
  if (n.includes("name")) return "name";
  return null;
}

// Health check runs FIRST so a "guardian medical notes" column is dropped, never
// ingested. Order matters (Constitution III).
function mapColumn(header: string, sizeKeys: readonly string[]): ColumnMap {
  if (isHealthHeader(header)) return { type: "health" };

  const n = norm(header);
  if (!n) return { type: "unknown" };

  const isGuardianish = n.includes("guardian") || n.includes("parent") || n.includes("contact");
  if (isGuardianish) {
    const field = mapGuardianField(n);
    if (field) return { type: "guardian", index: guardianIndex(n), field };
    // "Guardian" / "Guardian 2" bare header → treat as that guardian's name.
    return { type: "guardian", index: guardianIndex(n), field: "name" };
  }

  // Combined name column ("Student Name", "Full Name", "Name").
  if (
    n === "studentname" ||
    n === "fullname" ||
    n === "name" ||
    n === "student" ||
    n === "performer" ||
    n === "performername"
  ) {
    return { type: "name_combined" };
  }

  if (n === "firstname" || n === "first" || n === "studentfirstname" || n === "firstnamestudent") {
    return { type: "first" };
  }
  if (n === "lastname" || n === "last" || n === "studentlastname" || n === "surname") {
    return { type: "last" };
  }

  if (
    n.includes("gradyear") ||
    n.includes("graduationyear") ||
    n === "grad" ||
    n === "classof" ||
    n === "gradyr" ||
    n === "year"
  ) {
    return { type: "grad" };
  }

  const size = mapSizeColumn(n, sizeKeys);
  if (size) return size;

  return { type: "unknown" };
}

// ----------------------------------------------------------------------------
// CSV tokenizer (RFC-4180-ish: quoted fields, "" escapes, newlines in quotes)
// ----------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sawAny = false;

  // Normalize BOM.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAny = true;
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAny = false;
      continue;
    }
    field += c;
    sawAny = true;
  }
  // Flush trailing field/row (unless the file ended on a clean newline).
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Field helpers
// ----------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Parse a grad year: 4-digit in range, or 2-digit shorthand → 2000+n. null if empty; false-ish handled by caller via NaN. */
function parseGradYear(raw: string): number | null | "invalid" {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}$/.test(v)) {
    const y = parseInt(v, 10);
    return y >= 1990 && y <= 2100 ? y : "invalid";
  }
  if (/^\d{2}$/.test(v)) {
    return 2000 + parseInt(v, 10);
  }
  return "invalid";
}

/** Split a combined "First Last" (or "Last, First") into parts. */
function splitName(full: string): { first: string; last: string } {
  const v = full.trim().replace(/\s+/g, " ");
  if (!v) return { first: "", last: "" };
  if (v.includes(",")) {
    const [last, first] = v.split(",");
    return { first: (first ?? "").trim(), last: (last ?? "").trim() };
  }
  const parts = v.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function trimOrNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export function parseRosterCsv(
  text: string,
  sizeKeys: readonly string[] = DEFAULT_SIZE_KEYS,
): ParseResult {
  const grid = parseCsv(text);
  const errors: RowError[] = [];
  const skippedColumns: SkippedColumn[] = [];
  const rows: ParsedStudent[] = [];

  if (grid.length === 0) return { rows, errors, skippedColumns };

  const headerCells = grid[0];
  const maps = headerCells.map((h) => mapColumn(h, sizeKeys));

  // Record skipped health columns once, in header order.
  headerCells.forEach((h, i) => {
    if (maps[i].type === "health") {
      skippedColumns.push({
        header: h.trim() || `(column ${i + 1})`,
        reason: "skipped — this product does not store health or medical information",
      });
    }
  });

  let current: ParsedStudent | null = null;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const dataRow = r; // 1-based data-row number (header is row 0 → data starts at 1)

    // Skip fully-blank lines.
    if (cells.every((c) => c.trim() === "")) continue;

    // Gather student identity + sizes, and per-index guardian fields.
    let first = "";
    let last = "";
    let gradRaw = "";
    const sizes: Record<string, string> = {};
    const guardianByIndex = new Map<number, Partial<ParsedGuardian>>();

    cells.forEach((cellRaw, ci) => {
      const map = maps[ci];
      if (!map || map.type === "health" || map.type === "unknown") return;
      const cell = (cellRaw ?? "").trim();
      switch (map.type) {
        case "first":
          if (cell) first = cell;
          break;
        case "last":
          if (cell) last = cell;
          break;
        case "name_combined":
          if (cell) {
            const s = splitName(cell);
            first = s.first;
            last = s.last;
          }
          break;
        case "grad":
          if (cell) gradRaw = cell;
          break;
        case "size":
          if (cell) sizes[map.key] = cell;
          break;
        case "guardian": {
          const g = guardianByIndex.get(map.index) ?? {};
          if (cell) {
            g[map.field] = cell as never;
            guardianByIndex.set(map.index, g);
          }
          break;
        }
      }
    });

    // Assemble this row's guardians (repeated-column shape), ordered by index.
    const rowGuardians: ParsedGuardian[] = [];
    for (const idx of [...guardianByIndex.keys()].sort((a, b) => a - b)) {
      const g = guardianByIndex.get(idx)!;
      if (g.name || g.email || g.phone || g.relationship) {
        rowGuardians.push({
          name: (g.name ?? "").trim(),
          email: trimOrNull(g.email ?? undefined),
          phone: trimOrNull(g.phone ?? undefined),
          relationship: trimOrNull(g.relationship ?? undefined),
        });
      }
    }

    const hasStudentIdentity = first !== "" || last !== "";

    // Validate guardian emails on this row first (applies to new + continuation).
    const badEmail = rowGuardians.find((g) => g.email !== null && !isValidEmail(g.email));
    if (badEmail) {
      errors.push({
        row: dataRow,
        message: `Invalid guardian email "${badEmail.email}" — row excluded.`,
      });
      continue;
    }

    const mergeInto = (student: ParsedStudent) => {
      if (rowGuardians.length > 0) {
        student.guardians.push(...rowGuardians);
        student.sourceRows.push(dataRow);
        student.mergedRowCount += 1;
      }
    };

    // Case A — no student identity on this (non-blank) row. If it carries a
    // guardian, it's a repeated-row continuation of the student being built;
    // otherwise the row is malformed (missing name).
    if (!hasStudentIdentity) {
      if (current && rowGuardians.length > 0) {
        mergeInto(current);
      } else {
        errors.push({ row: dataRow, message: "Missing student name — row excluded." });
      }
      continue;
    }

    // Case B — identity repeats the student being built (same first + last, and
    // a grad year that matches or is omitted): repeated-row continuation.
    const gradMatchesCurrent =
      current !== null && (gradRaw.trim() === "" || parseGradYear(gradRaw) === current.gradYear);
    const identityMatchesCurrent =
      current !== null &&
      first.toLowerCase() === current.firstName.toLowerCase() &&
      last.toLowerCase() === current.lastName.toLowerCase() &&
      gradMatchesCurrent;
    if (identityMatchesCurrent && current) {
      mergeInto(current);
      continue;
    }

    // Case C — a NEW student. Validate both name parts + grad year.
    if (first === "" || last === "") {
      errors.push({
        row: dataRow,
        message: "Student needs both a first and last name — row excluded.",
      });
      current = null;
      continue;
    }

    const grad = parseGradYear(gradRaw);
    if (grad === "invalid") {
      errors.push({
        row: dataRow,
        message: `Invalid grad year "${gradRaw.trim()}" — row excluded.`,
      });
      current = null;
      continue;
    }

    const student: ParsedStudent = {
      sourceRows: [dataRow],
      firstName: first,
      lastName: last,
      gradYear: grad,
      sizes,
      guardians: rowGuardians,
      mergedRowCount: 0,
    };
    rows.push(student);
    current = student;
  }

  return { rows, errors, skippedColumns };
}
