import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";
import type { FlagKey } from "@/lib/flags";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";

// Comp-week readiness (season-workflow redesign). Extracted from the Today home
// so the Season page's next-comp feature row and Wave B's competition command
// center reuse the exact same five checks + open-slot math. Same lean-by-
// construction rule the dashboard has always followed: a check's backing query
// runs ONLY when its flag is on AND the caller's role has read access, so a
// program without shifts/packet never pays for those round-trips.
//
// Reads only — no mutations. The caller has already resolved the next comp
// (id/name/date/host_school); this fills in itinerary, attendance, shift, meal,
// and packet state and turns it into UI-ready rows.

export type ReadinessTone = "ok" | "warn" | "alert" | "neutral";

// Which job a check is about. Callers that need to find one (the hub's glance
// cards ask "was a packet check built?") match on THIS, never on the href —
// a link is a destination, and matching a destination by string suffix breaks
// silently the day the route moves.
export type ReadinessKey =
  | "itinerary"
  | "attendance"
  | "shifts"
  | "meals"
  | "packet";

export interface ReadinessCheck {
  key: ReadinessKey;
  ok: boolean;
  tone: ReadinessTone;
  label: string;
  href: string;
  action: string;
  // A neutral check is informational and not-applicable-yet (e.g. a comp with no
  // volunteer shifts planned): it renders with a gray dot and is excluded from
  // the readiness denominator so it neither credits nor penalises the score.
  neutral?: boolean;
}

// The comp a readiness pass runs against — just the identity fields the caller
// already has in hand.
export interface ReadinessComp {
  id: string;
  name: string;
  date: string | null;
  host_school: string | null;
}

export interface CompReadinessArgs {
  programId: string;
  comp: ReadinessComp;
  flags: Record<FlagKey, boolean>;
  role: Role;
  base: string; // program URL base, e.g. `/${slug}`
}

export interface CompReadiness {
  // Raw state (the hero/feature row uses these for countdown + meta).
  itinPublished: boolean | null;
  firstStart: string | null;
  // Attendance is THREE states, and they are three different facts. `expected`
  // used to carry expected+partial under the name of one of them, so a comp with
  // partial attendees read as fully expected and the partial number could not be
  // reached from the hub at all. They are counted separately now; `attending` is
  // the derived expected+partial figure meals are built on.
  expected: number;
  partial: number;
  absent: number;
  attending: number;
  openSlots: number;
  packetStatus: string | null;
  // UI-ready rows + how many are green.
  checks: ReadinessCheck[];
  done: number;
  // Denominator for the score: non-neutral checks only (neutral rows, like a
  // comp with no volunteer shifts planned, don't count toward the total).
  total: number;
}

// Load the readiness state + build the five checks for one competition.
export async function loadCompReadiness(
  supabase: SupabaseClient,
  { programId, comp, flags, role, base }: CompReadinessArgs,
): Promise<CompReadiness> {
  // Per-check gates (flag on AND role has read access), mirroring the dashboard.
  // The shifts check links to /comms/shifts, which requireFlag-gates on BOTH
  // comms AND shifts — so the link (and its backing query) only appear when both
  // flags are on, otherwise the "Fill shifts" href would 404.
  const showShifts = flags.shifts && flags.comms && SHIFT_WRITE_ROLES.includes(role);
  const showPacket = flags.competitions && flags.packet_parse;

  // ---- Itinerary (+ earliest call time) -------------------------------------
  const { data: itin } = await supabase
    .from("itineraries")
    .select("id, status")
    .eq("program_id", programId)
    .eq("competition_id", comp.id)
    .maybeSingle();
  const itinRow = itin as { id: string; status: string } | null;
  let firstStart: string | null = null;
  if (itinRow) {
    const { data: firstItem } = await supabase
      .from("itinerary_items")
      .select("starts_at")
      .eq("itinerary_id", itinRow.id)
      .not("starts_at", "is", null)
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    firstStart = (firstItem as { starts_at: string | null } | null)?.starts_at ?? null;
  }
  const itinPublished = itinRow ? itinRow.status === "published" : null;

  // ---- Attendance: one count per status -------------------------------------
  // Three head-counts rather than two. They run in the same Promise.all, so the
  // third costs no wall-clock time — and it buys back a number the hub could not
  // otherwise show, because "partial" folded into "expected" is unrecoverable
  // once counted.
  const [{ count: expectedCount }, { count: partialCount }, { count: absentCount }] =
    await Promise.all([
      supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId)
        .eq("competition_id", comp.id)
        .eq("status", "expected"),
      supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId)
        .eq("competition_id", comp.id)
        .eq("status", "partial"),
      supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId)
        .eq("competition_id", comp.id)
        .eq("status", "absent"),
    ]);
  const expected = expectedCount ?? 0;
  const partial = partialCount ?? 0;
  const absent = absentCount ?? 0;
  // Meals count everyone who will be there to eat: a student present for part of
  // the day still eats (same rule as loadMealData). Only absent is excluded.
  const attending = expected + partial;

  // ---- Volunteer shifts: open = needed − confirmed --------------------------
  let openSlots = 0;
  let shiftsPlanned = false;
  if (showShifts) {
    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("id, needed_count")
      .eq("program_id", programId)
      .eq("competition_id", comp.id);
    const shifts = (shiftRows as { id: string; needed_count: number }[] | null) ?? [];
    shiftsPlanned = shifts.length > 0;
    if (shifts.length > 0) {
      const { data: signupRows } = await supabase
        .from("shift_signups")
        .select("shift_id")
        .eq("program_id", programId)
        .eq("status", "confirmed")
        .in(
          "shift_id",
          shifts.map((s) => s.id),
        );
      const filled = new Map<string, number>();
      for (const su of (signupRows as { shift_id: string }[] | null) ?? []) {
        filled.set(su.shift_id, (filled.get(su.shift_id) ?? 0) + 1);
      }
      for (const s of shifts) {
        openSlots += Math.max(0, s.needed_count - (filled.get(s.id) ?? 0));
      }
    }
  }

  // ---- Latest host-packet parse ---------------------------------------------
  let packetStatus: string | null = null;
  if (showPacket) {
    const { data: parseRow } = await supabase
      .from("packet_parses")
      .select("status")
      .eq("program_id", programId)
      .eq("competition_id", comp.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    packetStatus = (parseRow as { status: string } | null)?.status ?? null;
  }

  // ---- Build the checklist rows ---------------------------------------------
  const compBase = `${base}/competitions/${comp.id}`;
  const checks: ReadinessCheck[] = [];

  checks.push({
    key: "itinerary",
    ok: itinPublished === true,
    tone: itinPublished ? "ok" : "warn",
    label:
      itinPublished === null
        ? "No itinerary yet"
        : itinPublished
          ? "Itinerary published"
          : "Itinerary still a draft",
    href: `${compBase}/itinerary`,
    action: itinPublished ? "View" : "Fix",
  });

  // Partial appears only when there IS one: a standing ", 0 partial" is noise on
  // every comp, and its absence is not a claim about anything.
  const attendanceSeeded = attending + absent > 0;
  checks.push({
    key: "attendance",
    ok: attendanceSeeded,
    tone: attendanceSeeded ? "ok" : "warn",
    label: attendanceSeeded
      ? `Attendance · ${expected} expected${partial > 0 ? `, ${partial} partial` : ""}, ${absent} absent`
      : "Attendance not seeded yet",
    href: `${compBase}/attendance`,
    action: "Edit",
  });

  if (showShifts) {
    if (!shiftsPlanned) {
      // No shifts attached to this comp yet — green would falsely read as
      // "covered" (the section below says none exist). Show a neutral, non-
      // counting row: not-applicable-yet, neither credited nor penalised.
      checks.push({
        key: "shifts",
        ok: false,
        tone: "neutral",
        label: "No volunteer shifts planned",
        href: `${base}/comms/shifts`,
        action: "Add shifts",
        neutral: true,
      });
    } else {
      checks.push({
        key: "shifts",
        ok: openSlots === 0,
        tone: openSlots === 0 ? "ok" : "warn",
        label:
          openSlots === 0
            ? "Volunteer shifts covered"
            : `Volunteer shifts · ${openSlots} slot${openSlots === 1 ? "" : "s"} open`,
        href: `${base}/comms/shifts`,
        action: openSlots === 0 ? "View" : "Fill shifts",
      });
    }
  }

  checks.push({
    key: "meals",
    // Meals = attendance expected + partial (same rule as loadMealData); only
    // absent students are excluded.
    ok: attending > 0,
    tone: attending > 0 ? "ok" : "warn",
    label:
      attending > 0
        ? `Meal count · ${attending} meals needed (expected + partial)`
        : "Meal count · no attendance yet",
    href: `${compBase}/meals`,
    action: "View",
  });

  if (showPacket) {
    const packet: Record<string, { tone: ReadinessTone; label: string }> = {
      accepted: { tone: "ok", label: "Host packet · parse accepted" },
      review: { tone: "warn", label: "Host packet · ready to review" },
      queued: { tone: "warn", label: "Host packet · parse queued" },
      running: { tone: "warn", label: "Host packet · parse running" },
      failed: { tone: "alert", label: "Host packet · parse failed" },
    };
    const p = packetStatus ? packet[packetStatus] : null;
    checks.push({
      key: "packet",
      ok: packetStatus === "accepted",
      tone: p?.tone ?? "warn",
      label: p?.label ?? "No host packet uploaded",
      href: `${compBase}/packet`,
      action: "Review",
    });
  }

  const done = checks.filter((c) => c.ok).length;
  const total = checks.filter((c) => !c.neutral).length;

  return {
    itinPublished,
    firstStart,
    expected,
    partial,
    absent,
    attending,
    openSlots,
    packetStatus,
    checks,
    done,
    total,
  };
}
