import Link from "next/link";
import { formatTimeInTz } from "@/lib/datetime";
import type { CompReadiness, ReadinessTone } from "@/lib/readiness";

// The hub's glance cards (spec 005 US7-1). One card per area of comp week —
// Attendance · Itinerary · Meals · Packet · Shifts · Travel · Results — each
// saying where that job stands right now and linking to the route that OWNS it.
// The hub used to re-implement those jobs inline (an attendance toggle grid, an
// itinerary list, a meal breakdown); the child routes already do them, so the
// hub's job is the one thing they can't do: show all of it at once.
//
// EVERY status line below comes out of state the page already has: the readiness
// pass it runs anyway (lib/readiness — itinerary, attendance, shifts, meals,
// packet), the linked-trip row, and the results row. Nothing here adds a query,
// which is what keeps a seven-card hub cheaper than the four inline sections it
// replaced.

export interface GlanceCard {
  key: string;
  title: string;
  status: string;
  tone: ReadinessTone;
  href: string;
}

// Plain-language packet states. The stored value is unchanged; only the words
// differ (same label-map idiom as COMPETITION_STATUS_LABELS).
const PACKET_STATE: Record<string, { label: string; tone: ReadinessTone }> = {
  queued: { label: "Reading it now", tone: "warn" },
  running: { label: "Reading it now", tone: "warn" },
  review: { label: "Draft ready to check", tone: "warn" },
  accepted: { label: "Checked and accepted", tone: "ok" },
  failed: { label: "Couldn't be read — enter it by hand", tone: "alert" },
};

export interface GlanceArgs {
  readiness: CompReadiness;
  base: string;
  compBase: string;
  tz: string;
  showTravel: boolean;
  trip: { id: string; name: string; is_overnight: boolean } | null;
  results: { placement: string | null; score: number | null } | null;
  compDone: boolean;
  resultsHref: string;
}

export function buildGlanceCards({
  readiness,
  base,
  compBase,
  tz,
  showTravel,
  trip,
  results,
  compDone,
  resultsHref,
}: GlanceArgs): GlanceCard[] {
  const cards: GlanceCard[] = [];

  // ---- Attendance ----------------------------------------------------------
  // Three statuses, three numbers. Folding partial into expected made a comp with
  // half-day students read as fully expected, and put the partial count out of
  // reach of the hub entirely. Partial shows only when there IS one — a standing
  // "0 partial" would be noise on every other competition.
  const seeded = readiness.attending + readiness.absent > 0;
  cards.push({
    key: "attendance",
    title: "Attendance",
    status: seeded
      ? [
          `${readiness.expected} expected`,
          readiness.partial > 0 ? `${readiness.partial} partial` : null,
          `${readiness.absent} absent`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Nobody on the list yet",
    tone: seeded ? "ok" : "warn",
    href: `${compBase}/attendance`,
  });

  // ---- Itinerary -----------------------------------------------------------
  const call = readiness.firstStart
    ? ` · first call ${formatTimeInTz(readiness.firstStart, tz)}`
    : "";
  cards.push({
    key: "itinerary",
    title: "Itinerary",
    status:
      readiness.itinPublished === null
        ? "Not started"
        : readiness.itinPublished
          ? `Published for families${call}`
          : `Draft — families can't see it yet${call}`,
    tone: readiness.itinPublished ? "ok" : "warn",
    href: `${compBase}/itinerary`,
  });

  // ---- Meals ---------------------------------------------------------------
  // Same rule as the meal PDF: everyone expected or partial eats.
  cards.push({
    key: "meals",
    title: "Meals",
    status:
      readiness.attending > 0
        ? `${readiness.attending} meals needed`
        : "Waiting on attendance",
    tone: readiness.attending > 0 ? "ok" : "warn",
    href: `${compBase}/meals`,
  });

  // ---- Host packet ---------------------------------------------------------
  // The readiness pass only builds a packet check when the packet flag is on, so
  // its presence IS the gate — no second copy of the rule here. Found by the
  // check's own key: matching a route suffix would silently stop finding it the
  // day the packet screen moves.
  if (readiness.checks.some((c) => c.key === "packet")) {
    const state = readiness.packetStatus
      ? Object.hasOwn(PACKET_STATE, readiness.packetStatus)
        ? PACKET_STATE[readiness.packetStatus]
        : null
      : null;
    cards.push({
      key: "packet",
      title: "Host packet",
      status: state?.label ?? "Nothing uploaded yet",
      tone: state?.tone ?? "warn",
      href: `${compBase}/packet`,
    });
  }

  // ---- Volunteer shifts ----------------------------------------------------
  // Same story: shifts need the shifts AND comms flags plus a role that can read
  // them, and the readiness check already carries that verdict — plus whether any
  // shift exists at all (a neutral, non-counting row when none do).
  const shiftCheck = readiness.checks.find((c) => c.key === "shifts");
  if (shiftCheck) {
    const filled = readiness.openSlots === 0;
    cards.push({
      key: "shifts",
      title: "Volunteer shifts",
      status: shiftCheck.neutral
        ? "None planned"
        : filled
          ? "Every spot filled"
          : `${readiness.openSlots} spot${readiness.openSlots === 1 ? "" : "s"} still open`,
      tone: shiftCheck.neutral ? "neutral" : filled ? "ok" : "warn",
      href: shiftCheck.href,
    });
  }

  // ---- Travel --------------------------------------------------------------
  if (showTravel) {
    cards.push({
      key: "travel",
      title: "Travel",
      status: trip
        ? `${trip.name} · ${trip.is_overnight ? "overnight" : "day trip"}`
        : "No trip yet",
      tone: trip ? "ok" : "warn",
      href: trip ? `${base}/travel/${trip.id}` : `${base}/travel`,
    });
  }

  // ---- Results -------------------------------------------------------------
  // The one card whose surface is on this page (no child route owns results), so
  // it points at the Results section's own disclosure.
  const scored = results && (results.placement || results.score !== null);
  cards.push({
    key: "results",
    title: "Results",
    status: scored
      ? [results?.placement, results?.score != null ? `${results.score}` : null]
          .filter(Boolean)
          .join(" · ")
      : compDone
        ? "Not recorded yet"
        : "After the competition",
    tone: scored ? "ok" : compDone ? "warn" : "neutral",
    href: resultsHref,
  });

  return cards;
}

export function GlanceCards({ cards }: { cards: GlanceCard[] }) {
  return (
    <div className="comp-glance">
      {cards.map((c) => (
        <Link key={c.key} href={c.href} className="comp-glance-card">
          <span className="comp-glance-title">
            <span className={`status-dot ${c.tone}`} aria-hidden="true" />
            {c.title}
          </span>
          <span className="comp-glance-status">{c.status}</span>
        </Link>
      ))}
    </div>
  );
}
