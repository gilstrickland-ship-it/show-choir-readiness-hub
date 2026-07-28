import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOSTED_SLOT_KIND_LABELS,
  type HostedSlotKind,
} from "@/lib/hosting";
import {
  listMonthsWithEntries,
  monthKeyForDate,
  reconciledThroughMonth,
  formatMonthKey,
  type LedgerMonthRow,
} from "@/lib/treasury";

// Data loaders for the four derived documents (§6, §7, T017). Each takes a
// Supabase client and a target id, and returns plain typed data the renderer
// turns into a PDF. Documents are derived, never stored (Constitution VI): every
// load runs against live rows. Returns null when the base resource is
// missing/hidden so the route can 404.
//
// TENANT SCOPING IS THIS FILE'S JOB, not the client's. Two callers pass a
// SERVICE-ROLE client — the share-link parent packet route and the export-all
// zip builder — so RLS is off for them and an unscoped child query renders
// whatever rows happen to reference the parent id. Rows carrying another
// program's program_id can reference this program's parents (single-column FKs
// plus RLS write policies that only check the row's own program_id), so every
// child query below filters on the parent's program_id explicitly. Without that,
// another tenant's free text prints as a chaperone name on this program's
// parent-facing packet.

export interface Rider {
  name: string;
  absent: boolean;
}
export interface TravelGroupData {
  label: string;
  capacity: number | null;
  notes: string | null;
  chaperones: string[];
  riders: Rider[];
}
export interface TripDocData {
  programName: string;
  tz: string;
  tripName: string;
  startsOn: string | null;
  endsOn: string | null;
  isOvernight: boolean;
  competitionLinked: boolean;
  rooms: TravelGroupData[];
  buses: TravelGroupData[];
}

interface TripBase {
  program_id: string;
  season_id: string;
  competition_id: string | null;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_overnight: boolean;
}

function sortByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

// Assemble a trip's rooms + buses with alphabetical riders, chaperone names, and
// absent flags (from attendance when competition-linked).
export async function loadTripDoc(
  supabase: SupabaseClient,
  tripId: string,
): Promise<TripDocData | null> {
  const { data: tripRow } = await supabase
    .from("trips")
    .select(
      "program_id, season_id, competition_id, name, starts_on, ends_on, is_overnight",
    )
    .eq("id", tripId)
    .maybeSingle();
  const trip = tripRow as TripBase | null;
  if (!trip) return null;

  const { data: progRow } = await supabase
    .from("programs")
    .select("name, timezone")
    .eq("id", trip.program_id)
    .maybeSingle();
  const program = progRow as { name: string; timezone: string } | null;

  const { data: groupRows } = await supabase
    .from("travel_groups")
    .select("id, kind, label, capacity, notes, sort_order")
    .eq("program_id", trip.program_id)
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const groups =
    (groupRows as {
      id: string;
      kind: "room" | "bus";
      label: string;
      capacity: number | null;
      notes: string | null;
    }[] | null) ?? [];
  const groupIds = groups.map((g) => g.id);

  // Absent set (competition-linked only).
  const absent = new Set<string>();
  if (trip.competition_id) {
    const { data: att } = await supabase
      .from("attendance")
      .select("student_id")
      .eq("program_id", trip.program_id)
      .eq("competition_id", trip.competition_id)
      .eq("status", "absent");
    for (const a of (att as { student_id: string }[] | null) ?? []) {
      absent.add(a.student_id);
    }
  }

  const ridersByGroup = new Map<string, Rider[]>();
  const chaperonesByGroup = new Map<string, string[]>();
  if (groupIds.length > 0) {
    const { data: aRows } = await supabase
      .from("travel_assignments")
      .select("travel_group_id, student_id, student:students(first_name, last_name)")
      .eq("program_id", trip.program_id)
      .in("travel_group_id", groupIds);
    for (const a of (aRows as {
      travel_group_id: string;
      student_id: string;
      student: { first_name: string; last_name: string } | null;
    }[] | null) ?? []) {
      const list = ridersByGroup.get(a.travel_group_id) ?? [];
      list.push({
        name: a.student ? `${a.student.last_name}, ${a.student.first_name}` : "?",
        absent: absent.has(a.student_id),
      });
      ridersByGroup.set(a.travel_group_id, list);
    }

    const { data: cRows } = await supabase
      .from("travel_chaperones")
      .select("travel_group_id, name_override, guardian:guardians(name)")
      .eq("program_id", trip.program_id)
      .in("travel_group_id", groupIds);
    for (const c of (cRows as {
      travel_group_id: string;
      name_override: string | null;
      guardian: { name: string } | null;
    }[] | null) ?? []) {
      const list = chaperonesByGroup.get(c.travel_group_id) ?? [];
      list.push(c.guardian?.name ?? c.name_override ?? "?");
      chaperonesByGroup.set(c.travel_group_id, list);
    }
  }

  const toData = (kind: "room" | "bus"): TravelGroupData[] =>
    groups
      .filter((g) => g.kind === kind)
      .map((g) => ({
        label: g.label,
        capacity: g.capacity,
        notes: g.notes,
        chaperones: (chaperonesByGroup.get(g.id) ?? []).sort((a, b) => a.localeCompare(b)),
        riders: (ridersByGroup.get(g.id) ?? []).sort(sortByName),
      }));

  return {
    programName: program?.name ?? "",
    tz: program?.timezone ?? "UTC",
    tripName: trip.name,
    startsOn: trip.starts_on,
    endsOn: trip.ends_on,
    isOvernight: trip.is_overnight,
    competitionLinked: trip.competition_id != null,
    rooms: toData("room"),
    buses: toData("bus"),
  };
}

// ---- Parent packet (per competition) ---------------------------------------

export interface ItineraryItem {
  startsAt: string | null;
  endsAt: string | null;
  kind: string;
  title: string | null;
  location: string | null;
  details: string | null;
}
export interface ShiftRosterEntry {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  neededCount: number;
  volunteers: string[];
}
export interface PacketData {
  programName: string;
  tz: string;
  competitionName: string;
  date: string | null;
  hostSchool: string | null;
  venueAddress: string | null;
  itineraryPublished: boolean;
  items: ItineraryItem[];
  mealItems: ItineraryItem[];
  rooms: TravelGroupData[];
  buses: TravelGroupData[];
  shifts: ShiftRosterEntry[];
  programId: string;
}

interface CompBase {
  program_id: string;
  name: string;
  date: string | null;
  host_school: string | null;
  venue_address: string | null;
}

// Loads everything the parent packet pulls (§9). `itineraryPublished` lets the
// route refuse with 409 (invariant §9.3) before rendering.
export async function loadPacketData(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<PacketData | null> {
  const { data: compRow } = await supabase
    .from("competitions")
    .select("program_id, name, date, host_school, venue_address")
    .eq("id", competitionId)
    .maybeSingle();
  const comp = compRow as CompBase | null;
  if (!comp) return null;

  const { data: progRow } = await supabase
    .from("programs")
    .select("name, timezone")
    .eq("id", comp.program_id)
    .maybeSingle();
  const program = progRow as { name: string; timezone: string } | null;

  // Published itinerary + items.
  const { data: itinRow } = await supabase
    .from("itineraries")
    .select("id, status")
    .eq("program_id", comp.program_id)
    .eq("competition_id", competitionId)
    .maybeSingle();
  const itinerary = itinRow as { id: string; status: string } | null;
  const itineraryPublished = itinerary?.status === "published";

  let items: ItineraryItem[] = [];
  if (itinerary && itineraryPublished) {
    const { data: itemRows } = await supabase
      .from("itinerary_items")
      .select("starts_at, ends_at, kind, title, location, details, sort_order")
      .eq("program_id", comp.program_id)
      .eq("itinerary_id", itinerary.id)
      .order("sort_order", { ascending: true })
      .order("starts_at", { ascending: true, nullsFirst: false });
    items = ((itemRows as {
      starts_at: string | null;
      ends_at: string | null;
      kind: string;
      title: string | null;
      location: string | null;
      details: string | null;
    }[] | null) ?? []).map((r) => ({
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      kind: r.kind,
      title: r.title,
      location: r.location,
      details: r.details,
    }));
  }

  // Bus + room groups from the trip(s) linked to this competition.
  const { data: tripRows } = await supabase
    .from("trips")
    .select("id")
    .eq("program_id", comp.program_id)
    .eq("competition_id", competitionId);
  const rooms: TravelGroupData[] = [];
  const buses: TravelGroupData[] = [];
  for (const t of (tripRows as { id: string }[] | null) ?? []) {
    const td = await loadTripDoc(supabase, t.id);
    if (td) {
      rooms.push(...td.rooms);
      buses.push(...td.buses);
    }
  }

  // Shift roster (who's working which shift) for this competition.
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("id, title, starts_at, ends_at, needed_count")
    .eq("program_id", comp.program_id)
    .eq("competition_id", competitionId)
    .order("starts_at", { ascending: true, nullsFirst: false });
  const shiftBase =
    (shiftRows as {
      id: string;
      title: string;
      starts_at: string | null;
      ends_at: string | null;
      needed_count: number;
    }[] | null) ?? [];
  const shifts: ShiftRosterEntry[] = [];
  if (shiftBase.length > 0) {
    const { data: signupRows } = await supabase
      .from("shift_signups")
      .select("shift_id, name, status, guardian:guardians(name)")
      .eq("program_id", comp.program_id)
      .in("shift_id", shiftBase.map((s) => s.id))
      .eq("status", "confirmed");
    const bySh = new Map<string, string[]>();
    for (const su of (signupRows as {
      shift_id: string;
      name: string | null;
      guardian: { name: string } | null;
    }[] | null) ?? []) {
      const list = bySh.get(su.shift_id) ?? [];
      list.push(su.guardian?.name ?? su.name ?? "Volunteer");
      bySh.set(su.shift_id, list);
    }
    for (const s of shiftBase) {
      shifts.push({
        title: s.title,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        neededCount: s.needed_count,
        volunteers: (bySh.get(s.id) ?? []).sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  return {
    programName: program?.name ?? "",
    tz: program?.timezone ?? "UTC",
    competitionName: comp.name,
    date: comp.date,
    hostSchool: comp.host_school,
    venueAddress: comp.venue_address,
    itineraryPublished,
    items,
    mealItems: items.filter((i) => i.kind === "meal"),
    rooms,
    buses,
    shifts,
    programId: comp.program_id,
  };
}

// ---- Meal count (per competition) ------------------------------------------

// MEAL-HEADCOUNT ASSUMPTION (§9 / §1.7 / US4): a meal headcount counts everyone
// who will be present to eat. Attendance has three states — `expected`, `partial`
// (there for part of the day), and `absent`. For MEALS, `partial` counts as
// ATTENDING: a student present for part of the day still eats, and undercounting
// meals strands a kid without food. Only `absent` is excluded. This is a
// deliberately generous count (better one extra boxed lunch than one short).
export interface MealEnsembleCount {
  ensembleName: string;
  attending: number; // expected + partial
  absent: number;
}
export interface MealData {
  programName: string;
  tz: string;
  competitionName: string;
  date: string | null;
  hostSchool: string | null;
  venueAddress: string | null;
  mealNote: string | null;
  ensembles: MealEnsembleCount[];
  totalAttending: number;
  totalAbsent: number;
  absentNames: string[]; // "Last, First"
}

interface MealCompBase {
  program_id: string;
  season_id: string;
  name: string;
  date: string | null;
  host_school: string | null;
  venue_address: string | null;
  meal_note: string | null;
}

// Per-ensemble meal headcount for one competition. Attendance is grouped by the
// PARTICIPATING ensemble each student belongs to (Feature 004): a competition can
// include several ensembles, so grouping is restricted to that competition's
// junction so a student's unrelated membership never mis-buckets them. A double-
// rostered student counts once in the total (attendance is one row per student)
// and buckets under their first participating ensemble; students with no
// participating membership fall under "Unassigned".
export async function loadMealData(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<MealData | null> {
  const { data: compRow } = await supabase
    .from("competitions")
    .select("program_id, season_id, name, date, host_school, venue_address, meal_note")
    .eq("id", competitionId)
    .maybeSingle();
  const comp = compRow as MealCompBase | null;
  if (!comp) return null;

  // Participating ensembles (junction) — the grouping key set.
  const { data: ceRows } = await supabase
    .from("competition_ensembles")
    .select("ensemble_id")
    .eq("program_id", comp.program_id)
    .eq("competition_id", competitionId);
  const participatingIds = ((ceRows as { ensemble_id: string }[] | null) ?? []).map(
    (r) => r.ensemble_id,
  );

  const { data: progRow } = await supabase
    .from("programs")
    .select("name, timezone")
    .eq("id", comp.program_id)
    .maybeSingle();
  const program = progRow as { name: string; timezone: string } | null;

  // Attendance rows + student names.
  const { data: attRows } = await supabase
    .from("attendance")
    .select("student_id, status, students(first_name, last_name)")
    .eq("program_id", comp.program_id)
    .eq("competition_id", competitionId);
  const attendance =
    (attRows as {
      student_id: string;
      status: "expected" | "absent" | "partial";
      students: { first_name: string; last_name: string } | null;
    }[] | null) ?? [];

  // Student → ensemble membership(s) in the competition's season.
  const studentIds = attendance.map((a) => a.student_id);
  const ensembleByStudent = new Map<string, string>();
  const ensembleNames = new Map<string, string>();
  if (studentIds.length > 0 && participatingIds.length > 0) {
    const { data: mems } = await supabase
      .from("ensemble_members")
      .select("student_id, ensemble_id, ensembles(name)")
      .eq("program_id", comp.program_id)
      .eq("season_id", comp.season_id)
      .in("ensemble_id", participatingIds)
      .in("student_id", studentIds);
    for (const m of (mems as {
      student_id: string;
      ensemble_id: string;
      ensembles: { name: string } | null;
    }[] | null) ?? []) {
      if (!ensembleByStudent.has(m.student_id)) {
        ensembleByStudent.set(m.student_id, m.ensemble_id);
        if (m.ensembles?.name) ensembleNames.set(m.ensemble_id, m.ensembles.name);
      }
    }
  }

  const UNASSIGNED = "__unassigned__";
  const counts = new Map<string, { attending: number; absent: number }>();
  const absentNames: string[] = [];
  let totalAttending = 0;
  let totalAbsent = 0;

  for (const a of attendance) {
    const key = ensembleByStudent.get(a.student_id) ?? UNASSIGNED;
    const bucket = counts.get(key) ?? { attending: 0, absent: 0 };
    if (a.status === "absent") {
      bucket.absent += 1;
      totalAbsent += 1;
      const nm = a.students ? `${a.students.last_name}, ${a.students.first_name}` : "?";
      absentNames.push(nm);
    } else {
      // expected OR partial → attending for meals (assumption above).
      bucket.attending += 1;
      totalAttending += 1;
    }
    counts.set(key, bucket);
  }

  const ensembles: MealEnsembleCount[] = Array.from(counts.entries())
    .map(([key, v]) => ({
      ensembleName: key === UNASSIGNED ? "Unassigned" : ensembleNames.get(key) ?? "Ensemble",
      attending: v.attending,
      absent: v.absent,
    }))
    .sort((a, b) => a.ensembleName.localeCompare(b.ensembleName));

  absentNames.sort((a, b) => a.localeCompare(b));

  return {
    programName: program?.name ?? "",
    tz: program?.timezone ?? "UTC",
    competitionName: comp.name,
    date: comp.date,
    hostSchool: comp.host_school,
    venueAddress: comp.venue_address,
    mealNote: comp.meal_note,
    ensembles,
    totalAttending,
    totalAbsent,
    absentNames,
  };
}

// ---- Host-mode event documents (per hosted_event) --------------------------
// Three day-of documents (master schedule, homeroom door signs, director packets)
// all derive from one hosted event's schools + slots (Constitution VI — nothing
// stored). One loader feeds all three; each renderer picks what it needs. NO
// visiting-school student data exists to load — hosted_schools holds adult
// contact + a performer COUNT only (Constitution III).

export interface HostSlotData {
  kind: HostedSlotKind;
  kindLabel: string;
  label: string | null;
  schoolName: string | null;
  startsAt: string | null;
  durationMinutes: number | null;
}
export interface HostSchoolData {
  id: string;
  schoolName: string;
  ensembleName: string | null;
  directorName: string | null;
  directorEmail: string | null;
  directorPhone: string | null;
  performerCount: number | null;
  division: string | null;
  costumeColors: string | null;
  homeroom: string | null;
  arrivalNotes: string | null;
  warmupAt: string | null; // derived: first warm-up slot start for this school
  performAt: string | null; // derived: first perform slot start for this school
}
export interface HostEventDocData {
  programName: string;
  tz: string;
  eventName: string;
  date: string | null; // event_date (all-day)
  endDate: string | null; // last day when multi-day (Wave N); null = single-day
  venueNotes: string | null;
  hostContact: string | null; // day-of contact line for visiting directors
  schools: HostSchoolData[];
  slots: HostSlotData[]; // master schedule, ordered by starts_at then sort_order
  awardsSlots: { startsAt: string | null; label: string | null }[];
}

interface HostEventBase {
  program_id: string;
  name: string;
  event_date: string | null;
  end_date: string | null;
  venue_notes: string | null;
  host_contact: string | null;
}

export async function loadHostEventDoc(
  supabase: SupabaseClient,
  eventId: string,
): Promise<HostEventDocData | null> {
  const { data: eventRow } = await supabase
    .from("hosted_events")
    .select("program_id, name, event_date, end_date, venue_notes, host_contact")
    .eq("id", eventId)
    .maybeSingle();
  const event = eventRow as HostEventBase | null;
  if (!event) return null;

  const { data: progRow } = await supabase
    .from("programs")
    .select("name, timezone")
    .eq("id", event.program_id)
    .maybeSingle();
  const program = progRow as { name: string; timezone: string } | null;

  const { data: schoolRows } = await supabase
    .from("hosted_schools")
    .select(
      "id, school_name, ensemble_name, director_name, director_email, director_phone, performer_count, division, costume_colors, homeroom, arrival_notes, sort_order",
    )
    .eq("program_id", event.program_id)
    .eq("hosted_event_id", eventId)
    .order("sort_order", { ascending: true });
  const schoolsRaw =
    (schoolRows as {
      id: string;
      school_name: string;
      ensemble_name: string | null;
      director_name: string | null;
      director_email: string | null;
      director_phone: string | null;
      performer_count: number | null;
      division: string | null;
      costume_colors: string | null;
      homeroom: string | null;
      arrival_notes: string | null;
    }[] | null) ?? [];

  const { data: slotRows } = await supabase
    .from("hosted_slots")
    .select("hosted_school_id, kind, label, starts_at, duration_minutes, sort_order")
    .eq("program_id", event.program_id)
    .eq("hosted_event_id", eventId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true });
  const slotsRaw =
    (slotRows as {
      hosted_school_id: string | null;
      kind: HostedSlotKind;
      label: string | null;
      starts_at: string | null;
      duration_minutes: number | null;
    }[] | null) ?? [];

  const nameById = new Map<string, string>();
  for (const s of schoolsRaw) nameById.set(s.id, s.school_name);

  // Per-school derived warm-up + perform times (first of each kind).
  const warmupBySchool = new Map<string, string | null>();
  const performBySchool = new Map<string, string | null>();
  for (const slot of slotsRaw) {
    if (!slot.hosted_school_id) continue;
    if (slot.kind === "warmup" && !warmupBySchool.has(slot.hosted_school_id)) {
      warmupBySchool.set(slot.hosted_school_id, slot.starts_at);
    }
    if (slot.kind === "perform" && !performBySchool.has(slot.hosted_school_id)) {
      performBySchool.set(slot.hosted_school_id, slot.starts_at);
    }
  }

  const schools: HostSchoolData[] = schoolsRaw.map((s) => ({
    id: s.id,
    schoolName: s.school_name,
    ensembleName: s.ensemble_name,
    directorName: s.director_name,
    directorEmail: s.director_email,
    directorPhone: s.director_phone,
    performerCount: s.performer_count,
    division: s.division,
    costumeColors: s.costume_colors,
    homeroom: s.homeroom,
    arrivalNotes: s.arrival_notes,
    warmupAt: warmupBySchool.get(s.id) ?? null,
    performAt: performBySchool.get(s.id) ?? null,
  }));

  const slots: HostSlotData[] = slotsRaw.map((slot) => ({
    kind: slot.kind,
    kindLabel: HOSTED_SLOT_KIND_LABELS[slot.kind],
    label: slot.label,
    schoolName: slot.hosted_school_id ? nameById.get(slot.hosted_school_id) ?? null : null,
    startsAt: slot.starts_at,
    durationMinutes: slot.duration_minutes,
  }));

  const awardsSlots = slotsRaw
    .filter((s) => s.kind === "awards")
    .map((s) => ({ startsAt: s.starts_at, label: s.label }));

  return {
    programName: program?.name ?? "",
    tz: program?.timezone ?? "UTC",
    eventName: event.name,
    date: event.event_date,
    endDate: event.end_date,
    venueNotes: event.venue_notes,
    hostContact: event.host_contact,
    schools,
    slots,
    awardsSlots,
  };
}

// ---- Board snapshot (per season) -------------------------------------------

export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${dollars}`;
}

export interface SnapshotLine {
  name: string;
  plannedCents: number;
  actualCents: number;
}
export interface SnapshotCategory {
  name: string;
  direction: "income" | "expense";
  lines: SnapshotLine[];
  plannedCents: number;
  actualCents: number;
}
export interface BoardSnapshotData {
  programName: string;
  tz: string;
  seasonLabel: string;
  budgetName: string | null;
  incomeCategories: SnapshotCategory[];
  expenseCategories: SnapshotCategory[];
  uncategorizedInCents: number;
  uncategorizedOutCents: number;
  totalPlannedIncome: number;
  totalActualIncome: number;
  totalPlannedExpense: number;
  totalActualExpense: number;
  // "Reconciled through {Month YYYY}" — the latest contiguous month whose books
  // were checked against the bank statement (Wave L). Null when none yet.
  reconciledThroughLabel: string | null;
}

interface SeasonBase {
  program_id: string;
  label: string;
}

// Treasury summary for the board meeting: planned (budget_lines) vs actual
// (ledger_entries excluding voided) per category, plus season header totals.
// Queried directly against the schema (§7).
export async function loadBoardSnapshot(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<BoardSnapshotData | null> {
  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("program_id, label")
    .eq("id", seasonId)
    .maybeSingle();
  const season = seasonRow as SeasonBase | null;
  if (!season) return null;

  const { data: progRow } = await supabase
    .from("programs")
    .select("name, timezone")
    .eq("id", season.program_id)
    .maybeSingle();
  const program = progRow as { name: string; timezone: string } | null;

  // Active budget for the season (fall back to the most recent budget).
  const { data: budgetRows } = await supabase
    .from("budgets")
    .select("id, name, status, created_at")
    .eq("program_id", season.program_id)
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false });
  const budgets =
    (budgetRows as { id: string; name: string; status: string; created_at: string }[] | null) ??
    [];
  const budget = budgets.find((b) => b.status === "active") ?? budgets[0] ?? null;

  // Actuals per budget_line (exclude voided), plus uncategorized buckets.
  const actualByLine = new Map<string, number>();
  let uncategorizedIn = 0;
  let uncategorizedOut = 0;
  const { data: ledgerRows } = await supabase
    .from("ledger_entries")
    .select("direction, amount_cents, budget_line_id, voided_at, entry_date")
    .eq("program_id", season.program_id)
    .eq("season_id", seasonId)
    .is("voided_at", null);
  const ledger =
    (ledgerRows as {
      direction: "in" | "out";
      amount_cents: number;
      budget_line_id: string | null;
      voided_at: string | null;
      entry_date: string;
    }[] | null) ?? [];
  for (const e of ledger) {
    const amt = Number(e.amount_cents);
    if (e.budget_line_id) {
      actualByLine.set(e.budget_line_id, (actualByLine.get(e.budget_line_id) ?? 0) + amt);
    } else if (e.direction === "in") {
      uncategorizedIn += amt;
    } else {
      uncategorizedOut += amt;
    }
  }

  // "Reconciled through" — months (this season) with activity, matched against
  // the program's reconciliation records (Wave L). The ledger query already
  // excludes voided rows, so every fetched row counts toward its month.
  const monthsWithEntries = listMonthsWithEntries(ledger as LedgerMonthRow[]);
  let reconciledThroughLabel: string | null = null;
  if (monthsWithEntries.length > 0) {
    const { data: recRows } = await supabase
      .from("ledger_reconciliations")
      .select("month")
      .eq("program_id", season.program_id);
    const reconciledKeys = ((recRows as { month: string }[] | null) ?? [])
      .map((r) => monthKeyForDate(r.month))
      .filter((k): k is string => k !== null);
    const through = reconciledThroughMonth(monthsWithEntries, reconciledKeys);
    reconciledThroughLabel = through ? formatMonthKey(through) : null;
  }

  const incomeCategories: SnapshotCategory[] = [];
  const expenseCategories: SnapshotCategory[] = [];

  if (budget) {
    const { data: catRows } = await supabase
      .from("budget_categories")
      .select("id, name, direction, sort_order")
      .eq("program_id", season.program_id)
      .eq("budget_id", budget.id)
      .order("sort_order", { ascending: true });
    const cats =
      (catRows as {
        id: string;
        name: string;
        direction: "income" | "expense";
        sort_order: number;
      }[] | null) ?? [];

    let lineRows: {
      id: string;
      category_id: string;
      name: string;
      planned_cents: number;
      sort_order: number;
    }[] = [];
    if (cats.length > 0) {
      const { data: lr } = await supabase
        .from("budget_lines")
        .select("id, category_id, name, planned_cents, sort_order")
        .eq("program_id", season.program_id)
        .in("category_id", cats.map((c) => c.id))
        .order("sort_order", { ascending: true });
      lineRows =
        (lr as typeof lineRows | null) ?? [];
    }

    for (const cat of cats) {
      const lines: SnapshotLine[] = lineRows
        .filter((l) => l.category_id === cat.id)
        .map((l) => ({
          name: l.name,
          plannedCents: Number(l.planned_cents),
          actualCents: actualByLine.get(l.id) ?? 0,
        }));
      const catData: SnapshotCategory = {
        name: cat.name,
        direction: cat.direction,
        lines,
        plannedCents: lines.reduce((s, l) => s + l.plannedCents, 0),
        actualCents: lines.reduce((s, l) => s + l.actualCents, 0),
      };
      if (cat.direction === "income") incomeCategories.push(catData);
      else expenseCategories.push(catData);
    }
  }

  const sum = (cats: SnapshotCategory[], key: "plannedCents" | "actualCents") =>
    cats.reduce((s, c) => s + c[key], 0);

  return {
    programName: program?.name ?? "",
    tz: program?.timezone ?? "UTC",
    seasonLabel: season.label,
    budgetName: budget?.name ?? null,
    incomeCategories,
    expenseCategories,
    uncategorizedInCents: uncategorizedIn,
    uncategorizedOutCents: uncategorizedOut,
    totalPlannedIncome: sum(incomeCategories, "plannedCents"),
    totalActualIncome: sum(incomeCategories, "actualCents") + uncategorizedIn,
    totalPlannedExpense: sum(expenseCategories, "plannedCents"),
    totalActualExpense: sum(expenseCategories, "actualCents") + uncategorizedOut,
    reconciledThroughLabel,
  };
}
