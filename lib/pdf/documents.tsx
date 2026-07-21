import React from "react";
import { Document, View, Text, DocPage, styles } from "./components";
import { formatDateInTz, formatTimeInTz } from "@/lib/datetime";
import {
  formatCents,
  type TripDocData,
  type TravelGroupData,
  type PacketData,
  type BoardSnapshotData,
  type SnapshotCategory,
  type MealData,
} from "./queries";

// The four derived documents (§6, §7, T017). Pure: data in, PDF tree out. Times
// render in the program tz (Constitution VII); brand chrome comes from
// components.tsx (Constitution IX). SERVER-ONLY — imported by the api/pdf route.

// Constitution III / §6: printed sheets carry names + logistics only; the
// school's med-forms binder lives outside the system and travels with the
// chaperone. Every bus manifest reminds staff of it.
const MED_BINDER_LINE =
  "Before departure: confirm the school's medical-forms binder is on the bus with the lead chaperone. (Health information lives outside this system — it is not printed here.)";

const RELEASED_LINE =
  "Riders leaving with their family instead of the bus: check Released and note the adult's name beside the rider.";

function tripDateRange(data: { startsOn: string | null; endsOn: string | null }, tz: string): string {
  if (!data.startsOn) return "";
  const start = formatDateInTz(`${data.startsOn}T12:00:00Z`, tz);
  if (!data.endsOn || data.endsOn === data.startsOn) return start;
  return `${start} – ${formatDateInTz(`${data.endsOn}T12:00:00Z`, tz)}`;
}

function ChaperoneLine({ chaperones }: { chaperones: string[] }) {
  return (
    <Text style={{ marginBottom: 6 }}>
      <Text style={styles.bold}>Chaperone{chaperones.length === 1 ? "" : "s"}: </Text>
      {chaperones.length > 0 ? chaperones.join(", ") : "____________________________"}
    </Text>
  );
}

// ============================ BUS MANIFEST ============================
// One page per bus: riders alphabetical with blank Out/Back check columns, a
// chaperone line, absent annotations, and the static med-binder checklist line.

export function BusManifest({ data }: { data: TripDocData }) {
  const subtitle = `${data.programName}${tripDateRange(data, data.tz) ? ` · ${tripDateRange(data, data.tz)}` : ""}`;
  return (
    <Document title={`Bus manifest — ${data.tripName}`}>
      {data.buses.length === 0 ? (
        <DocPage tz={data.tz} footerNote="Bus manifest">
          <Text style={styles.title}>Bus manifest — {data.tripName}</Text>
          <Text style={styles.muted}>No buses have been set up for this trip yet.</Text>
        </DocPage>
      ) : (
        data.buses.map((bus, i) => (
          <DocPage key={i} tz={data.tz} footerNote="Bus manifest">
            <View style={styles.header}>
              <Text style={styles.brandName}>BUS MANIFEST</Text>
              <Text style={styles.title}>{bus.label}</Text>
              <Text style={styles.subtitle}>
                {data.tripName}
                {subtitle ? ` · ${subtitle}` : ""}
              </Text>
            </View>

            <ChaperoneLine chaperones={bus.chaperones} />
            <Text style={{ marginBottom: 8, ...styles.muted }}>
              {bus.riders.length} rider{bus.riders.length === 1 ? "" : "s"}
              {bus.capacity != null ? ` · capacity ${bus.capacity}` : ""}
              {bus.notes ? ` · ${bus.notes}` : ""}
            </Text>

            <View style={styles.tableHeadRow}>
              <Text style={[styles.bold, { flexGrow: 1 }]}>Rider</Text>
              <Text style={[styles.bold, styles.checkboxCol]}>Out</Text>
              <Text style={[styles.bold, styles.checkboxCol]}>Back</Text>
              <Text style={[styles.bold, styles.releasedCol]}>Released</Text>
            </View>
            {bus.riders.map((r, ri) => (
              <View style={styles.tableRow} key={ri}>
                <Text style={{ flexGrow: 1 }}>
                  {r.name}
                  {r.absent && data.competitionLinked ? (
                    <Text style={styles.muted}> (absent)</Text>
                  ) : null}
                </Text>
                <View style={styles.checkboxCol}>
                  <View style={styles.checkbox} />
                </View>
                <View style={styles.checkboxCol}>
                  <View style={styles.checkbox} />
                </View>
                <View style={styles.releasedCol}>
                  <View style={styles.checkbox} />
                </View>
              </View>
            ))}
            {bus.riders.length === 0 && (
              <Text style={styles.muted}>No riders assigned.</Text>
            )}

            <View
              style={{
                marginTop: 18,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 8,
                flexDirection: "row",
              }}
              wrap={false}
            >
              <View style={[styles.checkbox, { marginRight: 8, marginTop: 1 }]} />
              <Text style={{ flexShrink: 1 }}>{MED_BINDER_LINE}</Text>
            </View>

            <Text style={{ marginTop: 8, ...styles.muted }}>{RELEASED_LINE}</Text>
          </DocPage>
        ))
      )}
    </Document>
  );
}

// ============================ ROOM SHEET ============================
// Default: per-room occupant lists + a hall-chaperone summary page.
// Door variant (?variant=door): one room per page, big type, for taping to doors.

function RoomBlock({ room, competitionLinked }: { room: TravelGroupData; competitionLinked: boolean }) {
  return (
    <View style={styles.section} wrap={false}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>{room.label}</Text>
        <Text style={[styles.muted, { marginLeft: 8 }]}>
          {room.riders.length}
          {room.capacity != null ? ` / ${room.capacity}` : ""}
        </Text>
      </View>
      <ChaperoneLine chaperones={room.chaperones} />
      {room.riders.map((r, i) => (
        <Text key={i} style={{ marginBottom: 2 }}>
          • {r.name}
          {r.absent && competitionLinked ? <Text style={styles.muted}> (absent)</Text> : null}
        </Text>
      ))}
      {room.riders.length === 0 && <Text style={styles.muted}>Empty</Text>}
      {room.notes ? <Text style={[styles.muted, { marginTop: 4 }]}>{room.notes}</Text> : null}
    </View>
  );
}

export function RoomSheet({ data, variant }: { data: TripDocData; variant: "default" | "door" }) {
  const subtitle = `${data.programName}${tripDateRange(data, data.tz) ? ` · ${tripDateRange(data, data.tz)}` : ""}`;

  if (variant === "door") {
    return (
      <Document title={`Door slips — ${data.tripName}`}>
        {data.rooms.length === 0 ? (
          <DocPage tz={data.tz} footerNote="Door slips">
            <Text style={styles.title}>Door slips — {data.tripName}</Text>
            <Text style={styles.muted}>No rooms set up for this trip yet.</Text>
          </DocPage>
        ) : (
          data.rooms.map((room, i) => (
            <DocPage key={i} tz={data.tz} footerNote="Door slip">
              <Text style={{ fontSize: 40, fontFamily: "Helvetica-Bold", marginBottom: 12 }}>
                {room.label}
              </Text>
              <Text style={{ fontSize: 14, marginBottom: 12 }}>
                <Text style={styles.bold}>Chaperone: </Text>
                {room.chaperones.length > 0 ? room.chaperones.join(", ") : "____________________"}
              </Text>
              {room.riders.map((r, ri) => (
                <Text key={ri} style={{ fontSize: 22, marginBottom: 8 }}>
                  {r.name}
                  {r.absent && data.competitionLinked ? (
                    <Text style={{ fontSize: 14, color: "#6b7280" }}> (absent)</Text>
                  ) : null}
                </Text>
              ))}
              {room.riders.length === 0 && (
                <Text style={{ fontSize: 18, color: "#6b7280" }}>Empty</Text>
              )}
            </DocPage>
          ))
        )}
      </Document>
    );
  }

  // Default: room lists then a hall-chaperone summary page.
  const hallSummary = data.rooms
    .filter((r) => r.chaperones.length > 0)
    .flatMap((r) => r.chaperones.map((c) => ({ room: r.label, chaperone: c })));

  return (
    <Document title={`Room sheet — ${data.tripName}`}>
      <DocPage tz={data.tz} footerNote="Room sheet">
        <View style={styles.header}>
          <Text style={styles.brandName}>ROOM SHEET</Text>
          <Text style={styles.title}>{data.tripName}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {data.rooms.length === 0 ? (
          <Text style={styles.muted}>No rooms set up for this trip yet.</Text>
        ) : (
          data.rooms.map((room, i) => (
            <RoomBlock key={i} room={room} competitionLinked={data.competitionLinked} />
          ))
        )}
      </DocPage>

      {hallSummary.length > 0 && (
        <DocPage tz={data.tz} footerNote="Room sheet">
          <Text style={styles.title}>Hall chaperone summary</Text>
          <Text style={[styles.subtitle, { marginBottom: 12 }]}>{data.tripName}</Text>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.bold, { width: 120 }]}>Room</Text>
            <Text style={[styles.bold, { flexGrow: 1 }]}>Chaperone</Text>
          </View>
          {hallSummary.map((h, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={{ width: 120 }}>{h.room}</Text>
              <Text style={{ flexGrow: 1 }}>{h.chaperone}</Text>
            </View>
          ))}
        </DocPage>
      )}
    </Document>
  );
}

// ============================ PARENT PACKET ============================

function itemTime(item: { startsAt: string | null; endsAt: string | null }, tz: string): string {
  if (!item.startsAt) return "—";
  const start = formatTimeInTz(item.startsAt, tz);
  return item.endsAt ? `${start}–${formatTimeInTz(item.endsAt, tz)}` : start;
}

function GroupList({ title, groups }: { title: string; groups: TravelGroupData[] }) {
  if (groups.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {groups.map((g, i) => (
        <View key={i} style={{ marginBottom: 6 }} wrap={false}>
          <Text style={styles.bold}>
            {g.label}
            {g.chaperones.length > 0 ? (
              <Text style={styles.muted}> — chaperone{g.chaperones.length === 1 ? "" : "s"}: {g.chaperones.join(", ")}</Text>
            ) : null}
          </Text>
          <Text>{g.riders.map((r) => r.name).join(", ") || "—"}</Text>
        </View>
      ))}
    </View>
  );
}

export function ParentPacket({ data }: { data: PacketData }) {
  const dateStr = data.date ? formatDateInTz(`${data.date}T12:00:00Z`, data.tz) : "";
  return (
    <Document title={`Parent packet — ${data.competitionName}`}>
      <DocPage tz={data.tz} footerNote="Parent packet">
        <View style={styles.header}>
          <Text style={styles.brandName}>PARENT PACKET</Text>
          <Text style={styles.title}>{data.competitionName}</Text>
          <Text style={styles.subtitle}>
            {data.programName}
            {dateStr ? ` · ${dateStr}` : ""}
          </Text>
          {(data.hostSchool || data.venueAddress) && (
            <Text style={styles.subtitle}>
              {data.hostSchool ?? ""}
              {data.hostSchool && data.venueAddress ? " · " : ""}
              {data.venueAddress ?? ""}
            </Text>
          )}
        </View>

        {/* Itinerary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Itinerary</Text>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.bold, { width: 90 }]}>Time</Text>
            <Text style={[styles.bold, { flexGrow: 1 }]}>Event</Text>
          </View>
          {data.items.map((it, i) => (
            <View style={styles.tableRow} key={i} wrap={false}>
              <Text style={{ width: 90 }}>{itemTime(it, data.tz)}</Text>
              <View style={{ flexGrow: 1, flexShrink: 1 }}>
                <Text style={styles.bold}>{it.title ?? it.kind}</Text>
                {(it.location || it.details) && (
                  <Text style={styles.muted}>
                    {it.location ?? ""}
                    {it.location && it.details ? " · " : ""}
                    {it.details ?? ""}
                  </Text>
                )}
              </View>
            </View>
          ))}
          {data.items.length === 0 && <Text style={styles.muted}>No itinerary items.</Text>}
        </View>

        {/* Meals (itinerary meal items) */}
        {data.mealItems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meals</Text>
            {data.mealItems.map((m, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                {itemTime(m, data.tz)} · {m.title ?? "Meal"}
                {m.location ? <Text style={styles.muted}> — {m.location}</Text> : null}
              </Text>
            ))}
          </View>
        )}

        {/* Travel groups */}
        <GroupList title="Buses" groups={data.buses} />
        <GroupList title="Rooms" groups={data.rooms} />

        {/* Shift roster */}
        {data.shifts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Volunteer shifts</Text>
            {data.shifts.map((s, i) => (
              <View key={i} style={{ marginBottom: 4 }} wrap={false}>
                <Text style={styles.bold}>
                  {s.title}
                  {s.startsAt ? <Text style={styles.muted}> · {itemTime(s, data.tz)}</Text> : null}
                </Text>
                <Text>
                  {s.volunteers.length > 0 ? s.volunteers.join(", ") : "(open — no volunteers yet)"}
                  <Text style={styles.muted}> ({s.volunteers.length}/{s.neededCount})</Text>
                </Text>
              </View>
            ))}
          </View>
        )}
      </DocPage>
    </Document>
  );
}

// ============================ MEAL COUNT ============================
// A meal-vendor / logistics headcount (§9 / §1.7 / US4): per-ensemble attending
// counts (partial counts as attending — see loadMealData), the absent list, and
// a NON-health logistics note (vendor, serving time). Constitution III: the
// note is explicitly labeled as logistics-only, never health/medical info.

const MEAL_NOTE_LABEL =
  "Logistics only (vendor, serving time, pickup location). Health and dietary/medical information is NOT recorded here — it lives outside this system.";

export function MealCount({ data }: { data: MealData }) {
  const dateStr = data.date ? formatDateInTz(`${data.date}T12:00:00Z`, data.tz) : "";
  return (
    <Document title={`Meal count — ${data.competitionName}`}>
      <DocPage tz={data.tz} footerNote="Meal count">
        <View style={styles.header}>
          <Text style={styles.brandName}>MEAL COUNT</Text>
          <Text style={styles.title}>{data.competitionName}</Text>
          <Text style={styles.subtitle}>
            {data.programName}
            {dateStr ? ` · ${dateStr}` : ""}
          </Text>
          {(data.hostSchool || data.venueAddress) && (
            <Text style={styles.subtitle}>
              {data.hostSchool ?? ""}
              {data.hostSchool && data.venueAddress ? " · " : ""}
              {data.venueAddress ?? ""}
            </Text>
          )}
        </View>

        {/* Headcount by ensemble */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Headcount by ensemble</Text>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.bold, { flexGrow: 1 }]}>Ensemble</Text>
            <Text style={[styles.bold, { width: 80, textAlign: "right" }]}>Meals</Text>
            <Text style={[styles.bold, { width: 80, textAlign: "right" }]}>Absent</Text>
          </View>
          {data.ensembles.map((e, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={{ flexGrow: 1 }}>{e.ensembleName}</Text>
              <Text style={{ width: 80, textAlign: "right" }}>{e.attending}</Text>
              <Text style={[styles.muted, { width: 80, textAlign: "right" }]}>{e.absent}</Text>
            </View>
          ))}
          {data.ensembles.length === 0 && (
            <Text style={styles.muted}>No attendance recorded yet.</Text>
          )}
          <View style={[styles.tableRow, { borderTopWidth: 1, borderTopColor: "#111827" }]}>
            <Text style={[styles.bold, { flexGrow: 1 }]}>Total meals needed</Text>
            <Text style={[styles.bold, { width: 80, textAlign: "right" }]}>
              {data.totalAttending}
            </Text>
            <Text style={[styles.muted, { width: 80, textAlign: "right" }]}>
              {data.totalAbsent}
            </Text>
          </View>
          <Text style={[styles.muted, { marginTop: 4 }]}>
            Meals count students marked expected or partial; only absent students
            are excluded.
          </Text>
        </View>

        {/* Logistics note */}
        {data.mealNote ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Logistics note</Text>
            <Text>{data.mealNote}</Text>
            <Text style={[styles.muted, { marginTop: 4, fontSize: 8 }]}>{MEAL_NOTE_LABEL}</Text>
          </View>
        ) : null}

        {/* Absent list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Absent ({data.absentNames.length})</Text>
          {data.absentNames.length === 0 ? (
            <Text style={styles.muted}>No absences recorded.</Text>
          ) : (
            data.absentNames.map((n, i) => (
              <Text key={i} style={{ marginBottom: 1 }}>
                • {n}
              </Text>
            ))
          )}
        </View>
      </DocPage>
    </Document>
  );
}

// ============================ BOARD SNAPSHOT ============================

function CategoryTable({ categories }: { categories: SnapshotCategory[] }) {
  return (
    <>
      <View style={styles.tableHeadRow}>
        <Text style={[styles.bold, { flexGrow: 1 }]}>Line</Text>
        <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>Planned</Text>
        <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>Actual</Text>
        <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>Variance</Text>
      </View>
      {categories.map((cat, ci) => (
        <View key={ci} wrap={false}>
          <Text style={[styles.bold, { marginTop: 6, marginBottom: 2 }]}>{cat.name}</Text>
          {cat.lines.map((l, li) => (
            <View style={styles.tableRow} key={li}>
              <Text style={{ flexGrow: 1 }}>{l.name}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{formatCents(l.plannedCents)}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{formatCents(l.actualCents)}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>
                {formatCents(l.actualCents - l.plannedCents)}
              </Text>
            </View>
          ))}
          <View style={[styles.tableRow, { borderBottomWidth: 1, borderBottomColor: "#111827" }]}>
            <Text style={[styles.bold, { flexGrow: 1 }]}>{cat.name} subtotal</Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>{formatCents(cat.plannedCents)}</Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>{formatCents(cat.actualCents)}</Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>
              {formatCents(cat.actualCents - cat.plannedCents)}
            </Text>
          </View>
        </View>
      ))}
      {categories.length === 0 && <Text style={styles.muted}>No categories.</Text>}
    </>
  );
}

function TotalRow({ label, planned, actual }: { label: string; planned: number; actual: number }) {
  return (
    <View style={styles.tableRow}>
      <Text style={[styles.bold, { flexGrow: 1 }]}>{label}</Text>
      <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>{formatCents(planned)}</Text>
      <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>{formatCents(actual)}</Text>
      <Text style={[styles.bold, { width: 90, textAlign: "right" }]}>{formatCents(actual - planned)}</Text>
    </View>
  );
}

export function BoardSnapshot({ data }: { data: BoardSnapshotData }) {
  const netPlanned = data.totalPlannedIncome - data.totalPlannedExpense;
  const netActual = data.totalActualIncome - data.totalActualExpense;
  return (
    <Document title={`Board snapshot — ${data.seasonLabel}`}>
      <DocPage tz={data.tz} footerNote="Board snapshot">
        <View style={styles.header}>
          <Text style={styles.brandName}>BOARD SNAPSHOT</Text>
          <Text style={styles.title}>{data.programName}</Text>
          <Text style={styles.subtitle}>
            Season {data.seasonLabel}
            {data.budgetName ? ` · ${data.budgetName}` : ""}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Income</Text>
          <CategoryTable categories={data.incomeCategories} />
          {data.uncategorizedInCents > 0 && (
            <View style={styles.tableRow}>
              <Text style={{ flexGrow: 1 }}>Uncategorized income</Text>
              <Text style={{ width: 90, textAlign: "right" }}>—</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{formatCents(data.uncategorizedInCents)}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>—</Text>
            </View>
          )}
          <TotalRow label="Total income" planned={data.totalPlannedIncome} actual={data.totalActualIncome} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Expenses</Text>
          <CategoryTable categories={data.expenseCategories} />
          {data.uncategorizedOutCents > 0 && (
            <View style={styles.tableRow}>
              <Text style={{ flexGrow: 1 }}>Uncategorized expense</Text>
              <Text style={{ width: 90, textAlign: "right" }}>—</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{formatCents(data.uncategorizedOutCents)}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>—</Text>
            </View>
          )}
          <TotalRow label="Total expenses" planned={data.totalPlannedExpense} actual={data.totalActualExpense} />
        </View>

        <View style={[styles.section, { marginTop: 6 }]}>
          <View style={[styles.tableRow, { borderTopWidth: 1, borderTopColor: "#111827" }]}>
            <Text style={[styles.bold, { flexGrow: 1, fontSize: 12 }]}>Net (income − expenses)</Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right", fontSize: 12 }]}>
              {formatCents(netPlanned)}
            </Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right", fontSize: 12 }]}>
              {formatCents(netActual)}
            </Text>
            <Text style={[styles.bold, { width: 90, textAlign: "right", fontSize: 12 }]}>
              {formatCents(netActual - netPlanned)}
            </Text>
          </View>
        </View>
      </DocPage>
    </Document>
  );
}
