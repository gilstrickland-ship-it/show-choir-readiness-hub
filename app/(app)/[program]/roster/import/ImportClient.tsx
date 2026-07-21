"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewImport, commitImport, type PreviewResult, type CommitResult } from "./actions";

// The only interactive surface in the roster (Constitution: 'use client' only
// where genuinely needed). Reads the chosen file client-side, posts its TEXT to
// the server for parsing, renders the preview, then commits. The commit re-parses
// the same text server-side — the client never sends parsed rows.

export function ImportClient({ programId }: { programId: string }) {
  const router = useRouter();
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setCommitted(null);
    setPreview(null);
    if (!file) {
      setCsvText("");
      setFileName("");
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    startTransition(async () => {
      const result = await previewImport(programId, text);
      setPreview(result);
    });
  }

  function onCommit() {
    if (!csvText) return;
    startTransition(async () => {
      const result = await commitImport(programId, csvText);
      setCommitted(result);
      setPreview(null);
      if (result.ok) router.refresh();
    });
  }

  const validCount = preview?.rows.length ?? 0;

  return (
    <div className="stack">
      <label>
        Choose a CSV file
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>
      {fileName && (
        <p className="muted">
          {fileName}
          {pending && " — working…"}
        </p>
      )}

      {committed && (
        <div className="stack">
          <p className={committed.ok ? "alert-ok" : "alert-error"}>{committed.message}</p>
          {committed.errorCount > 0 && (
            <p className="muted">
              {committed.errorCount} row(s) with errors were skipped.
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="stack">
          {preview.skippedColumns.length > 0 && (
            <div className="alert-error">
              <strong>Skipped columns</strong>
              <ul>
                {preview.skippedColumns.map((c) => (
                  <li key={c.header}>
                    {c.header} — {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="muted">
            Size columns found: {preview.sizeKeys.join(", ") || "none"}.
          </p>

          <h2>
            Preview — {validCount} student{validCount === 1 ? "" : "s"} ready
          </h2>
          {validCount === 0 ? (
            <p className="muted">No valid students to import.</p>
          ) : (
            <table className="members">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Grad</th>
                  <th>Sizes</th>
                  <th>Guardians</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.lastName}, {r.firstName}
                    </td>
                    <td>{r.gradYear ?? "—"}</td>
                    <td>
                      {Object.entries(r.sizes)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(", ") || "—"}
                    </td>
                    <td>
                      {r.guardians.length}
                      {r.mergedRowCount > 0 && (
                        <span
                          className="chip"
                          title="This student appeared on more than one row — the extra rows' parent contacts were combined."
                        >
                          combined from {r.mergedRowCount} rows
                        </span>
                      )}
                    </td>
                    <td className="muted">row {r.sourceRows.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview.errors.length > 0 && (
            <div className="stack">
              <h3>Excluded rows ({preview.errors.length})</h3>
              <ul>
                {preview.errors.map((err, i) => (
                  <li key={i} className="muted">
                    Row {err.row}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validCount > 0 && (
            <button type="button" onClick={onCommit} disabled={pending}>
              {pending ? "Importing…" : `Import ${validCount} student${validCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
