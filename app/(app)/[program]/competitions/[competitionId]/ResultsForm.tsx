import { COMMON_CAPTIONS, activeCaptions } from "@/lib/competitions";
import { saveResults } from "../actions";

// The comp hub's Results section (spec 005 US7-1). No child route owns results,
// so entry stays on the hub — in the same disclosure idiom as Details, with the
// placement/score line as the summary so a closed section still reads.

export interface ResultsRow {
  placement: string | null;
  division: string | null;
  score: number | null;
  captions: Record<string, unknown> | null;
  notes: string | null;
}

export function ResultsForm({
  programId,
  slug,
  competitionId,
  results,
  compDone,
  canWrite,
  summary,
  open,
  error,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  results: ResultsRow | null;
  compDone: boolean;
  canWrite: boolean;
  summary: string;
  open: boolean;
  error: string | null;
}) {
  const chosen = new Set(activeCaptions(results?.captions));

  return (
    <section className="comp-section" id="results">
      <div className="comp-section-head">
        <h2>Results</h2>
        <span className="comp-section-summary">{summary}</span>
      </div>
      {error && <p className="alert-error">{error}</p>}

      {!canWrite ? (
        results ? (
          <dl className="detail-list">
            <dt>Placement</dt>
            <dd>{results.placement ?? "—"}</dd>
            <dt>Score</dt>
            <dd>{results.score ?? "—"}</dd>
            <dt>Captions</dt>
            <dd>{activeCaptions(results.captions).join(", ") || "—"}</dd>
          </dl>
        ) : (
          <p className="muted">No results recorded.</p>
        )
      ) : (
        <>
          {!compDone && !results && (
            <p className="muted">
              Set the status to <strong>Done</strong> after the competition and
              record placement and captions here — they land in the trophy case.
            </p>
          )}
          <details className="stack" open={open}>
            <summary className="comp-disclosure">
              Record results — {summary}
            </summary>
            <form
              action={saveResults}
              className="stack"
              style={{ gap: "0.5rem", marginTop: "0.5rem" }}
            >
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="competitionId" value={competitionId} />
              <div className="row-inline">
                <label>
                  Placement
                  <input
                    type="text"
                    name="placement"
                    defaultValue={results?.placement ?? ""}
                    placeholder="Grand Champion, 2nd Runner-Up…"
                  />
                </label>
                <label>
                  Division
                  <input
                    type="text"
                    name="division"
                    defaultValue={results?.division ?? ""}
                  />
                </label>
                <label>
                  Score
                  <input
                    type="number"
                    step="0.01"
                    name="score"
                    className="num"
                    defaultValue={results?.score ?? ""}
                  />
                </label>
              </div>
              <fieldset className="stack">
                <legend>Caption awards</legend>
                <div className="row-inline">
                  {COMMON_CAPTIONS.map((name) => (
                    <label key={name} className="row-inline">
                      <input
                        type="checkbox"
                        name={`caption_${name}`}
                        defaultChecked={chosen.has(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
                <label>
                  Add more (comma-separated)
                  <input
                    type="text"
                    name="captions_extra"
                    placeholder="Best Ballad, Judges' Choice"
                  />
                </label>
              </fieldset>
              <label>
                Notes
                <textarea name="notes" rows={2} defaultValue={results?.notes ?? ""} />
              </label>
              <button type="submit">Save results</button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
