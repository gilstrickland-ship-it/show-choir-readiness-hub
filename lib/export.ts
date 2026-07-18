// CSV export helpers (§13.2, T029). Pure functions — no DB, no env — so the
// escaping (the load-bearing part) is unit-testable and every exported file goes
// through exactly one code path. Export-all is the anti-lock-in trust answer and
// the handoff vault's escape hatch: a real "export everything" button, not a
// promise.

// Escape one CSV cell per RFC 4180: wrap in quotes and double any embedded quote
// when the value contains a comma, quote, or newline. null/undefined → empty.
// Objects (e.g. the sizes jsonb) are JSON-stringified so nothing is lost.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Build a full CSV document (CRLF line endings per RFC 4180) from a header row
// and data rows. Cells are escaped individually.
export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  // Trailing newline so the file ends cleanly.
  return lines.join("\r\n") + "\r\n";
}

// A single CSV file destined for the export zip.
export interface CsvFile {
  name: string; // e.g. "students.csv"
  content: string;
}

// Convenience: build a CsvFile from headers + rows.
export function csvFile(
  name: string,
  headers: readonly string[],
  rows: readonly unknown[][],
): CsvFile {
  return { name, content: toCsv(headers, rows) };
}
