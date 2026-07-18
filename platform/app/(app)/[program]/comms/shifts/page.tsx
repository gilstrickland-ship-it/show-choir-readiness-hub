import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES, SETTINGS_ROLES } from "@/lib/nav";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { formatDateTimeInTz, toZonedInputValue } from "@/lib/datetime";
import { activeShareLinks, shareLinkUrl } from "@/lib/tokens";
import { CommsTabs } from "../CommsTabs";
import {
  createShift,
  updateShift,
  deleteShift,
  addStaffSignup,
  cancelSignup,
  regenerateSignupShareLink,
} from "./actions";

// Comms — Shifts tab (§8, T024). Volunteer shift CRUD + per-shift signups with
// open-slot counts. Attach a shift to a competition, a trip, an event, or
// nothing. Signups arrive through the tokenized parent surface (§8a) or are
// entered here by staff on a parent's behalf. Writers = director/admin/treasurer/
// costume_manager (SHIFT_WRITE_ROLES). Flag-gated on `shifts`.

interface ShiftRow {
  id: string;
  competition_id: string | null;
  trip_id: string | null;
  event_id: string | null;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  needed_count: number;
  notes: string | null;
}

interface SignupRow {
  id: string;
  shift_id: string;
  name: string | null;
  email: string | null;
  status: string;
  source: string;
}

interface NamedRow {
  id: string;
  name: string;
}

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  searchParams: Promise<{
    error?: string;
    created?: string;
    saved?: string;
    deleted?: string;
    signed?: string;
    cancelled?: string;
    edit?: string;
    share?: string;
  }>;
}) {
  const { program: slug } = await params;
  const { program, role, season } = await getTenantContext(slug);
  requireFlag(program, "comms");
  requireFlag(program, "shifts");
  if (!COMMS_ROLES.includes(role)) notFound();
  const canWrite = SHIFT_WRITE_ROLES.includes(role);
  const canShare = SETTINGS_ROLES.includes(role); // director/admin only (share_links RLS)
  const tz = program.timezone;
  const sp = await searchParams;

  const supabase = await createClient();

  // Broadcast signup link (FR-002 / §8a) — read-only browse of this season's open
  // shifts. Metadata-only once minted; the copyable URL rides ?share= once.
  const signupShareLinks =
    canShare && season
      ? (await activeShareLinks(supabase, program.id)).filter(
          (l) => l.resource === "signup_page" && l.resource_id === season.id,
        )
      : [];
  const freshSignupShareUrl = sp.share ? shareLinkUrl(sp.share) : null;

  const shifts: ShiftRow[] = season
    ? ((
        await supabase
          .from("shifts")
          .select(
            "id, competition_id, trip_id, event_id, title, starts_at, ends_at, needed_count, notes",
          )
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("starts_at", { ascending: true, nullsFirst: false })
      ).data as ShiftRow[] | null) ?? []
    : [];

  const shiftIds = shifts.map((s) => s.id);
  const signupsByShift = new Map<string, SignupRow[]>();
  const confirmedByShift = new Map<string, number>();
  if (shiftIds.length > 0) {
    const { data: suData } = await supabase
      .from("shift_signups")
      .select("id, shift_id, name, email, status, source")
      .eq("program_id", program.id)
      .in("shift_id", shiftIds)
      .order("created_at", { ascending: true });
    for (const su of (suData as SignupRow[] | null) ?? []) {
      const list = signupsByShift.get(su.shift_id) ?? [];
      list.push(su);
      signupsByShift.set(su.shift_id, list);
      if (su.status === "confirmed") {
        confirmedByShift.set(su.shift_id, (confirmedByShift.get(su.shift_id) ?? 0) + 1);
      }
    }
  }

  // Attach-target labels + option lists.
  const { data: compData } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("program_id", program.id)
    .order("date", { ascending: true, nullsFirst: false });
  const competitions = (compData as NamedRow[] | null) ?? [];

  const { data: tripData } = season
    ? await supabase
        .from("trips")
        .select("id, name")
        .eq("program_id", program.id)
        .eq("season_id", season.id)
        .order("starts_on", { ascending: true, nullsFirst: false })
    : { data: null };
  const trips = (tripData as NamedRow[] | null) ?? [];

  const { data: eventData } = season
    ? await supabase
        .from("events")
        .select("id, title")
        .eq("program_id", program.id)
        .eq("season_id", season.id)
        .order("starts_at", { ascending: true, nullsFirst: false })
    : { data: null };
  const events =
    ((eventData as { id: string; title: string }[] | null) ?? []).map((e) => ({
      id: e.id,
      name: e.title,
    }));

  const compName = new Map(competitions.map((c) => [c.id, c.name]));
  const tripName = new Map(trips.map((t) => [t.id, t.name]));
  const eventName = new Map(events.map((e) => [e.id, e.name]));

  function attachLabel(s: ShiftRow): string {
    if (s.competition_id) return `Competition · ${compName.get(s.competition_id) ?? "?"}`;
    if (s.trip_id) return `Trip · ${tripName.get(s.trip_id) ?? "?"}`;
    if (s.event_id) return `Event · ${eventName.get(s.event_id) ?? "?"}`;
    return "Standalone";
  }

  const editId = sp.edit;

  return (
    <section className="stack">
      <CommsTabs slug={slug} active="shifts" shiftsEnabled />
      <h1>Volunteer shifts</h1>

      {sp.created && <p className="alert-ok">Created {sp.created} shift(s).</p>}
      {sp.saved && <p className="alert-ok">Shift saved.</p>}
      {sp.deleted && <p className="alert-ok">Shift deleted.</p>}
      {sp.signed && <p className="alert-ok">Signup added.</p>}
      {sp.cancelled && <p className="alert-ok">Signup cancelled.</p>}
      {sp.error === "title" && <p className="alert-error">A shift needs a title.</p>}
      {sp.error === "name" && <p className="alert-error">A signup needs a name.</p>}
      {sp.error === "season" && (
        <p className="alert-error">Activate a season before adding shifts.</p>
      )}
      {sp.error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}

      {canWrite && (
        <p className="muted">
          Have a published competition itinerary?{" "}
          <Link href={`/${slug}/comms/shifts/suggest`}>Suggest shifts from it →</Link>
        </p>
      )}

      {/* Broadcast signup link (FR-002 / §8a) — director/admin only. */}
      {canShare && season && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Broadcast signup link</h2>
          {freshSignupShareUrl ? (
            <>
              <p className="muted">
                A read-only link parents can open to see and browse open shifts for{" "}
                {season.label}. Copy it now — for privacy the URL is shown only this
                once (parents claim shifts from their own family link):
              </p>
              <code style={{ wordBreak: "break-all" }}>{freshSignupShareUrl}</code>
            </>
          ) : signupShareLinks.length > 0 ? (
            <p className="muted">
              A broadcast signup link is active for {season.label}. The URL is only
              shown once at creation — regenerate to get a fresh copyable link (the
              old one stops working). Active links are listed in{" "}
              <Link href={`/${slug}/settings`}>Settings → Share links</Link>.
            </p>
          ) : (
            <p className="muted">
              No broadcast signup link yet. Generate a read-only link so anyone can
              browse this season&apos;s open shifts.
            </p>
          )}
          <form action={regenerateSignupShareLink}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <button type="submit" className="secondary">
              {signupShareLinks.length > 0
                ? "Regenerate signup link"
                : "Create signup link"}
            </button>
          </form>
        </div>
      )}

      {!season && (
        <p className="muted">
          No active season — shifts are season-scoped and can&apos;t be added yet.
        </p>
      )}

      {shifts.length === 0 && season && <p className="muted">No shifts yet.</p>}

      {shifts.map((s) => {
        const filled = confirmedByShift.get(s.id) ?? 0;
        const open = Math.max(0, s.needed_count - filled);
        const signups = signupsByShift.get(s.id) ?? [];
        const isEditing = canWrite && editId === s.id;
        return (
          <div key={s.id} className="confirm-box" style={{ width: "100%" }}>
            {isEditing ? (
              <form action={updateShift} className="stack">
                <input type="hidden" name="programId" value={program.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="shiftId" value={s.id} />
                <input type="hidden" name="tz" value={tz} />
                <div className="row-inline">
                  <label>
                    Title
                    <input type="text" name="title" defaultValue={s.title} required />
                  </label>
                  <label>
                    Needed
                    <input
                      type="number"
                      name="needed_count"
                      className="num"
                      min={1}
                      defaultValue={s.needed_count}
                    />
                  </label>
                </div>
                <div className="row-inline">
                  <label>
                    Starts
                    <input
                      type="datetime-local"
                      name="starts_at"
                      defaultValue={toZonedInputValue(s.starts_at, tz)}
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      type="datetime-local"
                      name="ends_at"
                      defaultValue={toZonedInputValue(s.ends_at, tz)}
                    />
                  </label>
                </div>
                <label>
                  Notes
                  <input type="text" name="notes" defaultValue={s.notes ?? ""} />
                </label>
                <div className="row-inline">
                  <button type="submit">Save</button>
                  <Link href={`/${slug}/comms/shifts`}>Cancel</Link>
                </div>
              </form>
            ) : (
              <>
                <strong>{s.title}</strong>
                <div className="muted">
                  {attachLabel(s)}
                  {s.starts_at ? ` · ${formatDateTimeInTz(s.starts_at, tz)}` : ""}
                </div>
                {s.notes && <div className="muted">{s.notes}</div>}
                <div style={{ marginTop: "0.3rem" }}>
                  {open > 0 ? (
                    <span>
                      {open} of {s.needed_count} spot{s.needed_count === 1 ? "" : "s"} open
                    </span>
                  ) : (
                    <span className="muted">Full ({s.needed_count} filled)</span>
                  )}
                </div>
              </>
            )}

            {/* Signups */}
            {signups.length > 0 && (
              <table className="members" style={{ marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Source</th>
                    <th>Status</th>
                    {canWrite && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {signups.map((su) => (
                    <tr key={su.id}>
                      <td>{su.name ?? "—"}</td>
                      <td className="muted">{su.email ?? "—"}</td>
                      <td className="muted">
                        {su.source === "staff_entered" ? "staff" : "signup link"}
                      </td>
                      <td>
                        <span className="badge">{su.status}</span>
                      </td>
                      {canWrite && (
                        <td>
                          {su.status === "confirmed" && (
                            <form action={cancelSignup}>
                              <input type="hidden" name="programId" value={program.id} />
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="signupId" value={su.id} />
                              <button type="submit" className="linklike danger">
                                Cancel
                              </button>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canWrite && !isEditing && (
              <div className="stack" style={{ marginTop: "0.5rem" }}>
                <form action={addStaffSignup} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="shiftId" value={s.id} />
                  <input type="text" name="name" placeholder="Add volunteer name" aria-label="Volunteer name" />
                  <input type="email" name="email" placeholder="Email (optional)" aria-label="Volunteer email" />
                  <button type="submit" className="secondary">
                    Add signup
                  </button>
                </form>
                <div className="row-inline">
                  <Link href={`/${slug}/comms/shifts?edit=${s.id}`}>Edit</Link>
                  <form action={deleteShift}>
                    <input type="hidden" name="programId" value={program.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="shiftId" value={s.id} />
                    <button type="submit" className="linklike danger">
                      Delete shift
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {canWrite && season && (
        <>
          <h2>Add a shift</h2>
          <form action={createShift} className="stack" style={{ width: "100%" }}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <input type="hidden" name="tz" value={tz} />
            <div className="row-inline">
              <label>
                Title
                <input type="text" name="title" required placeholder="Concessions crew" />
              </label>
              <label>
                Needed
                <input type="number" name="needed_count" className="num" min={1} defaultValue={1} />
              </label>
            </div>
            <div className="row-inline">
              <label>
                Starts
                <input type="datetime-local" name="starts_at" />
              </label>
              <label>
                Ends
                <input type="datetime-local" name="ends_at" />
              </label>
            </div>
            <div className="row-inline">
              <label>
                Attach to
                <select name="attach_kind" defaultValue="none">
                  <option value="none">Nothing (standalone)</option>
                  <option value="competition">Competition</option>
                  <option value="trip">Trip</option>
                  <option value="event">Event</option>
                </select>
              </label>
              <label>
                Which one
                <select name="attach_id" defaultValue="">
                  <option value="">—</option>
                  <optgroup label="Competitions">
                    {competitions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Trips">
                    {trips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Events">
                    {events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
            <label>
              Notes
              <input type="text" name="notes" placeholder="Bring a cash box" />
            </label>
            <p className="muted">
              Pick an attach kind and the matching item; the other selections are
              ignored.
            </p>
            <button type="submit">Add shift</button>
          </form>
        </>
      )}
    </section>
  );
}
