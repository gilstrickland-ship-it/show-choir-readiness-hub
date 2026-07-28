"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importIssues, type ImportIssue } from "@/lib/roster/import";
import { previewImport, commitImport, type PreviewResult, type CommitResult } from "./actions";

// The only interactive surface in the roster (Constitution: 'use client' only
// where genuinely needed — this one reads a file the user picked). Reads the
// chosen file client-side, posts its TEXT to the server for parsing, renders the
// preview, then commits. The commit re-parses the same text server-side — the
// client never sends parsed rows, and the role check lives in both actions.
//
// Wave 6 gave the three phases a name and a number. The flow was always
// choose → check → import, but nothing said so: a director who picked a file got
// a table and a button, with no sense of where they were or what was left. And
// what the parse found arrived in three unrelated shapes — a red box of skipped
// columns, a grey chip inside a table cell, a bullet list of excluded rows —
// which is now one list, worst first (lib/roster/import.ts `importIssues`).

const STEPS = ["Choose your file", "Check the preview", "Import"] as const;

const ISSUE_WORD: Record<ImportIssue["kind"], string> = {
  excluded: "Not imported",
  column: "Column dropped",
  combined: "Rows combined",
};

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
  const step = committed ? 3 : preview ? 2 : 1;
  const issues = preview ? importIssues(preview) : [];
  const blocking = issues.filter((i) => i.blocking).length;

  return (
    <div className="stack">
      <nav className="import-steps" aria-label="Import steps">
        <p className="eyebrow">
          Step {step} of {STEPS.length} — {STEPS[step - 1]}
        </p>
        <ol>
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < step ? "done" : n === step ? "now" : "todo";
            return (
              <li
                key={label}
                className={`import-step ${state}`}
                aria-current={state === "now" ? "step" : undefined}
              >
                <span className="import-step-mark" aria-hidden="true">
                  {state === "done" ? "✓" : "•"}
                </span>
                {n}. {label}
                <span className="import-step-state">
                  {" "}
                  —{" "}
                  {state === "done"
                    ? "done"
                    : state === "now"
                      ? "you are here"
                      : "not yet"}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

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
              {committed.errorCount} row{committed.errorCount === 1 ? "" : "s"} with
              problems {committed.errorCount === 1 ? "was" : "were"} left out. Fix
              them in your spreadsheet and import that file again.
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="stack">
          <h2>
            {validCount} student{validCount === 1 ? "" : "s"} ready to import
          </h2>
          <p className="muted">
            Nothing is saved yet. Size columns found:{" "}
            {preview.sizeKeys.join(", ") || "none"}.
          </p>

          {issues.length > 0 && (
            <div className="stack import-issues">
              <h3>
                {issues.length} thing{issues.length === 1 ? "" : "s"} to look at
                {blocking > 0 && (
                  <span className="muted"> · {blocking} kept data out</span>
                )}
              </h3>
              {/* A list, not a table: four columns of prose squeeze to three
                  words a line on a phone, and every entry here IS prose. */}
              <ul className="import-issue-list">
                {issues.map((issue, i) => (
                  <li
                    key={`${issue.kind}-${issue.where}-${i}`}
                    className={`import-issue ${issue.blocking ? "blocking" : ""}`}
                  >
                    <p className="import-issue-head">
                      <span
                        className={`family-link ${issue.blocking ? "bouncing" : "delivering"}`}
                      >
                        <span
                          className={`status-dot ${issue.blocking ? "alert" : "ok"}`}
                          aria-hidden="true"
                        />
                        {ISSUE_WORD[issue.kind]}
                      </span>
                      <strong>{issue.where}</strong>
                    </p>
                    <p>{issue.what}</p>
                    <p className="muted">{issue.fix ?? "Nothing to do."}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validCount === 0 ? (
            <p className="muted">
              Nothing in this file can be imported yet. Work through the list
              above, then choose the file again.
            </p>
          ) : (
            <table className="members">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Grad</th>
                  <th>Sizes</th>
                  <th>Guardians</th>
                  <th>From</th>
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
                    <td>{r.guardians.length}</td>
                    <td className="muted">
                      row{r.sourceRows.length === 1 ? "" : "s"}{" "}
                      {r.sourceRows.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {validCount > 0 && (
            <button type="button" onClick={onCommit} disabled={pending}>
              {pending
                ? "Importing…"
                : `Import ${validCount} student${validCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
