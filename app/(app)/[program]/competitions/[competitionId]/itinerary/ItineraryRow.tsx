import { Fragment } from "react";
import Link from "next/link";
import {
  ITINERARY_ITEM_KINDS,
  ITINERARY_ITEM_KIND_LABELS,
  type ItineraryItemKind,
} from "@/lib/competitions";
import { formatDateTimeInTz, toZonedInputValue } from "@/lib/datetime";
import { updateItineraryItem, deleteItineraryItem } from "./actions";
import { itemAnchor } from "./shared";

// One line of the day, and the two things a director does to one: correct it, or
// take it off the schedule (spec 005 T156).
//
// Every row used to BE a form: seven permanently-open inputs and a Save, with
// Delete a tab-stop away in the next cell. Nothing in the row said what time the
// bus leaves — you read it out of an input — and on a phone the whole schedule
// was a horizontal scroll of text boxes. The row states the facts now, and the
// inputs live behind one Edit disclosure.
//
// The panel opens in a row of its OWN, spanning every column (spec 005 T143b).
// `table.members` is `display:block; overflow-x:auto` so the grid can scroll on
// a phone, and a scroll container clips any absolutely-positioned descendant —
// so a floating panel came out sliced off at the cell edge, and even an
// expanding one opened most of the way off a 375px screen when it opened inside
// the last cell. A full-width row beneath, stuck to the left edge of the scroll
// port, is what puts it where it can be read.
//
// Writers edit in both draft AND published states (T055): schedules drift on
// competition day, and publishing is the parent-visibility gate — not a freeze.

export interface ItineraryItem {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
  kind: string;
  title: string | null;
  location: string | null;
  details: string | null;
  sort_order: number;
  updated_at: string | null;
}

export function ItineraryRow({
  programId,
  slug,
  competitionId,
  tz,
  item,
  canWrite,
  open,
  confirmDelete,
  error,
  columns,
  rowHref,
}: {
  programId: string;
  slug: string;
  competitionId: string;
  tz: string;
  item: ItineraryItem;
  canWrite: boolean;
  // The panel reopens on `?edit=<itemId>`, and every refusal from this row comes
  // back on it so the message lands inside the control that produced it.
  open: boolean;
  confirmDelete: boolean;
  error: string | null;
  // How many columns the panel row has to span.
  columns: number;
  // This page's URL with this row's panel open, closed, or asking to remove.
  rowHref: (itemId: string, mode: "open" | "close" | "confirm") => string;
}) {
  const anchor = itemAnchor(item.id);
  const panelId = `${anchor}-panel`;
  const kindLabel =
    ITINERARY_ITEM_KIND_LABELS[item.kind as ItineraryItemKind] ?? item.kind;
  const title = item.title ?? "Untitled";

  return (
    <Fragment>
      <tr id={anchor}>
        <td>{item.sort_order}</td>
        <td>{formatDateTimeInTz(item.starts_at, tz)}</td>
        <td>{kindLabel}</td>
        <td>
          {title}
          {item.location ? (
            <span className="muted"> · {item.location}</span>
          ) : null}
          {item.details ? (
            <div className="muted">{item.details}</div>
          ) : null}
        </td>
        {canWrite && (
          <td className="table-action">
            <Link
              href={rowHref(item.id, open ? "close" : "open")}
              className="comp-disclosure"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              aria-label={`Edit ${title}`}
            >
              {open ? "Close" : "Edit"}
            </Link>
          </td>
        )}
      </tr>

      {canWrite && open && (
        <tr className="table-panel-row" id={panelId}>
          <td colSpan={columns}>
            <div className="table-panel">
              <div className="stack itinerary-row-panel">
                <h3 className="drawer-title">Edit this item</h3>
                {error && <p className="alert-error">{error}</p>}

                <form
                  action={updateItineraryItem}
                  className="stack itinerary-row-form"
                >
                  <input type="hidden" name="programId" value={programId} />
                  <input type="hidden" name="slug" value={slug} />
                  <input
                    type="hidden"
                    name="competitionId"
                    value={competitionId}
                  />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="tz" value={tz} />
                  <ItemFields item={item} tz={tz} />
                  <button type="submit" className="secondary">
                    Save item
                  </button>
                </form>

                <div className="itinerary-row-form stack">
                  {confirmDelete ? (
                    <div className="confirm-box stack">
                      <p>
                        Take &ldquo;{title}&rdquo; off the schedule? Everyone
                        reading this itinerary stops seeing it.
                      </p>
                      <div className="row-inline">
                        <form action={deleteItineraryItem}>
                          <input
                            type="hidden"
                            name="programId"
                            value={programId}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <input
                            type="hidden"
                            name="competitionId"
                            value={competitionId}
                          />
                          <input type="hidden" name="itemId" value={item.id} />
                          <button type="submit" className="danger">
                            Remove it
                          </button>
                        </form>
                        <Link href={rowHref(item.id, "open")}>Keep it</Link>
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={rowHref(item.id, "confirm")}
                      className="linklike danger"
                    >
                      Remove this item…
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// The editable fields, shared by the row panel and the "+ Add an item" drawer.
// Both forms post every field they show, so an emptied one clears. Times arrive
// as program-tz wall clock and are stored UTC (Constitution VII).
export function ItemFields({
  item,
  tz,
  nextOrder,
}: {
  item: ItineraryItem | null;
  tz: string;
  // Where a NEW item lands in the running order; ignored when editing.
  nextOrder?: number;
}) {
  return (
    <>
      <div className="row-inline">
        <label>
          What happens
          <input
            type="text"
            name="title"
            required
            defaultValue={item?.title ?? ""}
            placeholder="Load the bus"
          />
        </label>
        <label>
          Kind
          <select name="kind" defaultValue={item?.kind ?? "other"}>
            {ITINERARY_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITINERARY_ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row-inline">
        <label>
          Starts
          <input
            type="datetime-local"
            name="starts_at"
            defaultValue={toZonedInputValue(item?.starts_at ?? null, tz)}
          />
        </label>
        <label>
          Ends
          <input
            type="datetime-local"
            name="ends_at"
            defaultValue={toZonedInputValue(item?.ends_at ?? null, tz)}
          />
        </label>
      </div>
      <div className="row-inline">
        <label>
          Where
          <input
            type="text"
            name="location"
            defaultValue={item?.location ?? ""}
            placeholder="North door"
          />
        </label>
        <label>
          Order in the day
          <input
            type="number"
            name="sort_order"
            className="num"
            defaultValue={item?.sort_order ?? nextOrder ?? 1}
          />
        </label>
      </div>
      <label>
        Anything else families should know
        <input
          type="text"
          name="details"
          defaultValue={item?.details ?? ""}
          placeholder="Bring your garment bag"
        />
      </label>
      <p className="muted">
        Do not enter health or medical information — this schedule is read by
        every family with the link.
      </p>
    </>
  );
}
