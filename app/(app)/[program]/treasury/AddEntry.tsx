import {
  LEDGER_DIRECTIONS,
  LEDGER_DIRECTION_LABELS,
  NO_HEALTH_LABEL,
  formatDateOnly,
  type LedgerDirection,
} from "@/lib/treasury";
import { addEntry } from "./actions";
import { LineSelect, optionName, type TagOptions } from "./shared";

// Recording money is four decisions (spec 005 US8-1): in or out, how much, who
// it went to or came from, and what it was for. Nothing else is a decision at
// the moment a check is written — which budget line, which competition, which
// trip, the receipt, and the date when it isn't today all sit behind one
// disclosure whose summary STATES what it currently holds, so a treasurer can
// see there is nothing hidden without opening it (the Wave-2 trip-page
// contract).
//
// Submit with that disclosure untouched and the entry saves dated today with
// nothing connected — an uncategorized entry, which the ledger's Uncategorized
// count then nudges. Filing it later is a void plus a fresh row, never an edit:
// the 0002 trigger freezes every money column after insert (Constitution V).

// Everything the drawer prefills after a "Void & redo". `redoOf` is the voided
// entry's id, posted back so the server can carry its RECEIPT forward: a file
// input cannot be prefilled, and dropping the receipt silently would lose the
// only proof of what the money bought. `hadReceipt` is what the panel says about
// it, so the treasurer can tell whether to attach a different file.
export interface EntryPrefill {
  redoOf: string;
  entry_date: string;
  direction: LedgerDirection;
  amount_cents: number;
  budget_line_id: string | null;
  competition_id: string | null;
  trip_id: string | null;
  memo: string | null;
  counterparty: string | null;
  hadReceipt: boolean;
}

export function AddEntry({
  programId,
  slug,
  seasonId,
  today,
  options,
  prefill,
}: {
  programId: string;
  slug: string;
  seasonId: string;
  // Today on the PROGRAM's calendar, not the server's — a 7pm entry in Chicago
  // would otherwise be dated tomorrow by a UTC host.
  today: string;
  options: TagOptions;
  prefill: EntryPrefill | null;
}) {
  const date = prefill?.entry_date ?? today;
  const connected = [
    optionName(options.lines, prefill?.budget_line_id),
    optionName(options.comps, prefill?.competition_id),
    optionName(options.trips, prefill?.trip_id),
  ].filter((n): n is string => !!n);

  return (
    <details className="drawer" open={!!prefill}>
      <summary className="button-link accent">+ Add entry</summary>
      <div className="drawer-panel" id="add-entry">
        <h2 className="drawer-title">
          {prefill ? "Redo this entry" : "Add an entry"}
        </h2>
        {prefill && (
          <p className="muted">
            The original stays in the ledger, voided. Fix what was wrong and
            save — this writes a new entry rather than changing the old one.
          </p>
        )}
        <form action={addEntry} className="stack" encType="multipart/form-data">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="seasonId" value={seasonId} />
          {prefill && (
            <input type="hidden" name="redo_of" value={prefill.redoOf} />
          )}

          <div className="money-decisions">
            <label>
              In or out?
              <select
                name="direction"
                required
                defaultValue={prefill?.direction ?? "out"}
              >
                {LEDGER_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {LEDGER_DIRECTION_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount $
              <input
                type="text"
                name="amount"
                inputMode="decimal"
                required
                placeholder="1,234.56"
                defaultValue={
                  prefill ? (prefill.amount_cents / 100).toFixed(2) : ""
                }
              />
            </label>
            <label>
              Paid to / received from
              <input
                type="text"
                name="counterparty"
                placeholder="Payee or source"
                defaultValue={prefill?.counterparty ?? ""}
              />
            </label>
            <label>
              What was it for
              <input
                type="text"
                name="memo"
                placeholder="Bus deposit"
                defaultValue={prefill?.memo ?? ""}
              />
            </label>
          </div>

          {/* Open only when a redo brought tags along, so the everyday path is
              four fields and a button. */}
          <details className="stack" open={connected.length > 0}>
            <summary className="money-disclosure">
              Connect it — dated {formatDateOnly(date)} ·{" "}
              {connected.length > 0 ? connected.join(" · ") : "nothing tagged"}
            </summary>
            <div className="stack money-connect">
              <label>
                Budget line
                <LineSelect
                  name="budget_line_id"
                  defaultValue={prefill?.budget_line_id ?? ""}
                  options={options}
                  blankLabel="Not on a line yet"
                />
              </label>
              <div className="row-inline">
                <label>
                  Competition
                  <select
                    name="competition_id"
                    defaultValue={prefill?.competition_id ?? ""}
                  >
                    <option value="">No competition</option>
                    {options.comps.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Trip
                  <select
                    name="trip_id"
                    defaultValue={prefill?.trip_id ?? ""}
                  >
                    <option value="">No trip</option>
                    {options.trips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date
                  {/* Deliberately NOT required. A required field inside a
                      collapsed <details> cannot be focused, so a browser
                      refuses the whole submit and reports nothing the
                      treasurer can see — the form just stops working. Blank
                      means today on the program's calendar, filled in by the
                      server. */}
                  <input type="date" name="entry_date" defaultValue={date} />
                </label>
              </div>
              <label>
                Receipt (PDF or image)
                <input
                  type="file"
                  name="receipt"
                  accept="application/pdf,image/*"
                />
              </label>
              {prefill?.hadReceipt && (
                <p className="muted">
                  The voided entry&apos;s receipt comes along automatically.
                  Attach a file here only if you want to replace it.
                </p>
              )}
              <p className="muted">
                Leave all of this alone and the entry saves dated today with
                nothing connected. The Uncategorized count on the ledger is how
                you find it again.
              </p>
            </div>
          </details>

          <p className="muted">{NO_HEALTH_LABEL}</p>
          <button type="submit">
            {prefill ? "Save corrected entry" : "Add entry"}
          </button>
        </form>
      </div>
    </details>
  );
}
