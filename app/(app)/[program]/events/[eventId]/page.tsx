import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeInTz } from "@/lib/datetime";
import { deleteEvent } from "../actions";
import { EVENTS_WRITE_ROLES, EVENT_KIND_LABELS } from "@/lib/events";
import { eventEnsembleIds } from "@/lib/competitions";
import { Flash } from "../../Flash";
import { readFlash, oneParam } from "@/lib/flash";
import { EVENT_FLASH_MAPS, type EventSection } from "../shared";
import { EventEdit, type EditableEvent } from "./EventEdit";

// One event (§5a, T013; re-shaped spec 005 Wave 11 / T159). Each materialized
// repeat occurrence is its own event and is edited and deleted here.
//
// The page now reads the way every detail surface reads since Wave 7: the facts
// in the open for anyone who can see the page, mutations behind labeled
// disclosures, and messages in the section that owns what happened — the edit
// panel for a save, the danger zone for a delete. Deleting takes two presses,
// because an event and its history go with it and nothing brings them back.

export const dynamic = "force-dynamic";

interface EventDetail extends EditableEvent {
  id: string;
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
  // Next hands back an ARRAY for a duplicated param, so every read goes through
  // oneParam — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, eventId } = await params;
  const { program, role } = await getTenantContext(slug);
  requireFlag(program, "events");
  const canWrite = (EVENTS_WRITE_ROLES as readonly string[]).includes(role);
  const tz = program.timezone;
  const sp = await searchParams;
  const one = (key: string): string | null => oneParam(sp, key);

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

  const flash = readFlash<EventSection>(sp, EVENT_FLASH_MAPS);
  // A refused save springs the edit panel open on the message that refused it.
  const editOpen = canWrite && (one("edit") === "1" || flash.error?.section === "details");
  const confirmDelete = canWrite && one("confirm") === "delete";

  const kindLabel =
    EVENT_KIND_LABELS[event.kind as keyof typeof EVENT_KIND_LABELS] ??
    event.kind;
  const whenLabel = event.starts_at
    ? formatDateTimeInTz(event.starts_at, tz)
    : "No time set";
  const audience =
    targetedEnsembleIds.length === 0
      ? "The whole program"
      : ensembles
          .filter((e) => targetedEnsembleIds.includes(e.id))
          .map((e) => e.name)
          .join(", ");

  return (
    <section className="stack">
      <p className="comp-back">
        <Link href={`/${slug}/events`}>← Events</Link>
      </p>

      <div className="comp-head">
        <div className="comp-head-titles">
          <div className="comp-status-row">
            <span className="chip">{kindLabel}</span>
          </div>
          <h1 className="comp-h1">{event.title}</h1>
          <p className="comp-meta">
            {whenLabel} · {audience}
          </p>
        </div>
      </div>

      <section className="comp-section" id="details">
        <div className="comp-section-head">
          <h2>Details</h2>
          <span className="comp-section-summary">{whenLabel}</span>
        </div>
        <Flash flash={flash} section="details" />
        <dl className="detail-list">
          <dt>Starts</dt>
          <dd>{whenLabel}</dd>
          <dt>Ends</dt>
          <dd>
            {event.ends_at ? (
              formatDateTimeInTz(event.ends_at, tz)
            ) : (
              <span className="muted">Not set</span>
            )}
          </dd>
          <dt>Who it&apos;s for</dt>
          <dd>{audience}</dd>
          <dt>Where</dt>
          <dd>
            {event.location ?? <span className="muted">Not set</span>}
          </dd>
          <dt>Note</dt>
          <dd>{event.note ?? <span className="muted">None</span>}</dd>
        </dl>
        {canWrite && (
          <EventEdit
            programId={program.id}
            slug={slug}
            event={event}
            tz={tz}
            ensembles={ensembles}
            targetedEnsembleIds={targetedEnsembleIds}
            summary={`${whenLabel} · ${kindLabel}`}
            open={editOpen}
          />
        )}
      </section>

      {canWrite && (
        <section className="comp-section" id="danger">
          <div className="comp-section-head">
            <h2>Danger zone</h2>
            <span className="comp-section-summary">
              Deleting an event can&apos;t be undone
            </span>
          </div>
          <Flash flash={flash} section="danger" />
          <details open={confirmDelete}>
            <summary className="comp-disclosure">
              Delete this event — {event.title}
            </summary>
            {confirmDelete ? (
              <div className="confirm-box stack">
                <p>
                  Delete {event.title}? A repeat makes one event per week, so
                  this deletes only this one.
                </p>
                <form action={deleteEvent} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="eventId" value={event.id} />
                  <button type="submit" className="danger">
                    Confirm delete event
                  </button>
                  <Link href={`/${slug}/events/${event.id}`}>Cancel</Link>
                </form>
              </div>
            ) : (
              <p>
                <Link
                  className="linklike danger"
                  href={`/${slug}/events/${event.id}?confirm=delete#danger`}
                >
                  Delete this event
                </Link>
              </p>
            )}
          </details>
        </section>
      )}
    </section>
  );
}
