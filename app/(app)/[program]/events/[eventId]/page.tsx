import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeInTz, toZonedInputValue } from "@/lib/datetime";
import { updateEvent, deleteEvent } from "../actions";
import { EVENTS_WRITE_ROLES, EVENT_KINDS, EVENT_KIND_LABELS } from "@/lib/events";
import { eventEnsembleIds } from "@/lib/competitions";

// Single event edit/delete (§5a, T013). Each materialized repeat occurrence is
// independently editable/deletable here. Times in program tz (Constitution VII).
// Audience is any subset of ensembles (Feature 004) — zero = whole program.

interface EventDetail {
  id: string;
  title: string;
  kind: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  note: string | null;
}

interface EnsembleRow {
  id: string;
  name: string;
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; eventId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { program: slug, eventId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "events");
  const canWrite = (EVENTS_WRITE_ROLES as readonly string[]).includes(role);
  const tz = program.timezone;
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: evData } = await supabase
    .from("events")
    .select("id, title, kind, starts_at, ends_at, location, note")
    .eq("id", eventId)
    .eq("program_id", program.id)
    .maybeSingle();
  const event = evData as EventDetail | null;
  if (!event) notFound();

  const targetedEnsembleIds = await eventEnsembleIds(supabase, eventId);

  const { data: ensData } = await supabase
    .from("ensembles")
    .select("id, name")
    .eq("program_id", program.id)
    .order("sort_order", { ascending: true });
  const ensembles = (ensData as EnsembleRow[] | null) ?? [];

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/events`}>← Events</Link>
      </p>
      <h1>{event.title}</h1>

      {sp.saved && <p className="alert-ok">Saved.</p>}
      {sp.error === "title" && <p className="alert-error">An event needs a title.</p>}
      {sp.error === "dates" && (
        <p className="alert-error">The end time is before the start.</p>
      )}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      <p className="muted">
        {event.starts_at ? formatDateTimeInTz(event.starts_at, tz) : "No time set"} · {EVENT_KIND_LABELS[event.kind as keyof typeof EVENT_KIND_LABELS] ?? event.kind}
      </p>

      {canWrite ? (
        <>
          <form action={updateEvent} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="tz" value={tz} />
            <div className="row-inline">
              <label>
                Title
                <input type="text" name="title" defaultValue={event.title} required />
              </label>
              <label>
                Kind
                <select name="kind" defaultValue={event.kind}>
                  {EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EVENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="stack">
              <legend>Ensembles</legend>
              <p className="muted">
                No boxes ticked = whole program; tick one or more to target a subset.
              </p>
              <div className="row-inline" style={{ flexWrap: "wrap" }}>
                {ensembles.map((e) => (
                  <label key={e.id} className="row-inline">
                    <input
                      type="checkbox"
                      name="ensemble_ids"
                      value={e.id}
                      defaultChecked={targetedEnsembleIds.includes(e.id)}
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row-inline">
              <label>
                Starts
                <input
                  type="datetime-local"
                  name="starts_at"
                  defaultValue={toZonedInputValue(event.starts_at, tz)}
                />
              </label>
              <label>
                Ends
                <input
                  type="datetime-local"
                  name="ends_at"
                  defaultValue={toZonedInputValue(event.ends_at, tz)}
                />
              </label>
              <label>
                Location
                <input type="text" name="location" defaultValue={event.location ?? ""} />
              </label>
            </div>
            <label>
              Note
              <input type="text" name="note" defaultValue={event.note ?? ""} />
            </label>
            <button type="submit">Save changes</button>
          </form>

          <form action={deleteEvent}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={event.id} />
            <button type="submit" className="danger">
              Delete event
            </button>
          </form>
        </>
      ) : (
        <dl className="detail-list">
          <dt>When</dt>
          <dd>{formatDateTimeInTz(event.starts_at, tz)}</dd>
          <dt>Ensembles</dt>
          <dd>
            {targetedEnsembleIds.length === 0
              ? "Whole program"
              : ensembles
                  .filter((e) => targetedEnsembleIds.includes(e.id))
                  .map((e) => e.name)
                  .join(", ")}
          </dd>
          <dt>Location</dt>
          <dd>{event.location ?? "—"}</dd>
          <dt>Note</dt>
          <dd>{event.note ?? "—"}</dd>
        </dl>
      )}
    </section>
  );
}
