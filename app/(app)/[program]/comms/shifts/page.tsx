import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES, SETTINGS_ROLES } from "@/lib/nav";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { activeShareLinks, shareLinkUrl } from "@/lib/tokens";
import { CommsTabs } from "../CommsTabs";
import { AddShift, type NamedOption } from "./AddShift";
import { ShiftCard, type ShiftRow, type SignupRow } from "./ShiftCard";
import { regenerateSignupShareLink } from "./actions";

// Comms — Shifts tab (§8, T024). Volunteer shift CRUD + per-shift signups with
// open-slot counts. Attach a shift to a competition, a trip, an event, or
// nothing. Signups arrive through the tokenized parent surface (§8a) or are
// entered here by staff on a parent's behalf. Writers = director/admin/treasurer/
// costume_manager (SHIFT_WRITE_ROLES). Flag-gated on `shifts`.
//
// Spec 005 US9-3 reshaped the page's controls to the app's standard idioms:
// creating is a drawer off the page head (AddShift), editing is a per-row
// `<details>` panel on the shift itself (ShiftCard), and a failure that belongs
// to one shift renders inside that shift's panel rather than at the top of a
// list the writer then has to scroll to find their row again.

interface NamedRow {
  id: string;
  name: string;
}

// A shift as this page reads it: what the card renders (ShiftRow) plus the three
// attach columns, which the page turns into one label and the card never sees.
interface ShiftQueryRow extends ShiftRow {
  competition_id: string | null;
  trip_id: string | null;
  event_id: string | null;
}

// Messages the page owns — the create drawer, the signup link, and the
// add-a-name form, none of which belong to a particular shift row.
const ERR: Record<string, string> = {
  title: "A shift needs a title.",
  name: "A signup needs a name.",
  season: "Activate a season before adding shifts.",
  save: "Couldn't save. Try again.",
  attach:
    "That competition, trip, or event isn't part of this program. Reload the page and pick one from the list.",
  shift: "That shift isn't part of this program. Reload the page and try again.",
  share:
    "Couldn't make a signup link. The old link has been retired, so make a new one before sharing.",
};

// Messages that belong to ONE shift. They arrive with `?edit=<shiftId>`, which
// is also what reopens that row's panel, so the message lands on the control
// that produced it.
const ROW_ERR: Record<string, string> = {
  title: "A shift needs a title.",
  in_use:
    "Couldn't delete this shift — something still refers to it, so it's still here.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string }>;
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug } = await params;
  const { program, role, season, flags } = await getTenantContext(slug);
  requireFlag(program, "comms");
  requireFlag(program, "shifts");
  if (!COMMS_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="Comms" role={role} allowed={COMMS_ROLES} />
    );
  }
  const canWrite = SHIFT_WRITE_ROLES.includes(role);
  const canShare = SETTINGS_ROLES.includes(role); // director/admin only (share_links RLS)
  const tz = program.timezone;

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();

  // The parent-facing signup link (FR-002 / §8a) — read-only browse of this
  // season's open shifts. Metadata-only once minted; the copyable URL rides
  // ?share= exactly once.
  const shareParam = one("share");
  const signupShareLinks =
    canShare && season
      ? (await activeShareLinks(supabase, program.id)).filter(
          (l) => l.resource === "signup_page" && l.resource_id === season.id,
        )
      : [];
  const freshSignupShareUrl = shareParam ? shareLinkUrl(shareParam) : null;

  const shifts: ShiftQueryRow[] = season
    ? ((
        await supabase
          .from("shifts")
          .select(
            "id, competition_id, trip_id, event_id, title, starts_at, ends_at, needed_count, notes",
          )
          .eq("program_id", program.id)
          .eq("season_id", season.id)
          .order("starts_at", { ascending: true, nullsFirst: false })
      ).data as ShiftQueryRow[] | null) ?? []
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
  const events: NamedOption[] =
    ((eventData as { id: string; title: string }[] | null) ?? []).map((e) => ({
      id: e.id,
      name: e.title,
    }));

  const compName = new Map(competitions.map((c) => [c.id, c.name]));
  const tripName = new Map(trips.map((t) => [t.id, t.name]));
  const eventName = new Map(events.map((e) => [e.id, e.name]));

  function attachLabel(s: ShiftQueryRow): string {
    if (s.competition_id) return `Competition · ${compName.get(s.competition_id) ?? "?"}`;
    if (s.trip_id) return `Trip · ${tripName.get(s.trip_id) ?? "?"}`;
    if (s.event_id) return `Event · ${eventName.get(s.event_id) ?? "?"}`;
    return "Standalone";
  }

  // A row's panel reopens on `?edit=<shiftId>` carrying its own message; without
  // an `edit` the code belongs to the page (the create drawer or the link).
  const errorCode = one("error");
  const openId = canWrite ? one("edit") : null;
  const rowError = openId ? message(ROW_ERR, errorCode) : null;
  const pageError = openId ? null : message(ERR, errorCode);
  const unknownError = !!errorCode && !rowError && !pageError;
  // A create that came back rejected reopens the drawer with its message inside,
  // rather than dropping it at the top of a page the drawer is closed over.
  const DRAWER_CODES = ["title", "save", "attach", "season"];
  const drawerError =
    pageError && DRAWER_CODES.includes(errorCode ?? "") ? pageError : null;

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">
            <Link href={`/${slug}/comms`}>← Comms</Link> · volunteer shifts
          </p>
          <h1 className="page-h1">Shifts</h1>
        </div>
        {canWrite && season && (
          <div className="page-head-actions">
            <AddShift
              programId={program.id}
              slug={slug}
              seasonId={season.id}
              tz={tz}
              competitions={competitions}
              trips={trips}
              events={events}
              open={!!drawerError}
              error={drawerError}
            />
          </div>
        )}
      </div>

      <CommsTabs
        slug={slug}
        active="shifts"
        digestEnabled={flags.digest}
        announcementsEnabled={flags.announcements}
        shiftsEnabled
      />

      {one("created") && <p className="alert-ok">Created {one("created")} shift(s).</p>}
      {one("saved") && <p className="alert-ok">Shift saved.</p>}
      {one("deleted") && <p className="alert-ok">Shift deleted.</p>}
      {one("signed") && <p className="alert-ok">Signup added.</p>}
      {one("cancelled") && <p className="alert-ok">Signup cancelled.</p>}
      {((pageError && !drawerError) || unknownError) && (
        <p className="alert-error">{pageError ?? "Something went wrong."}</p>
      )}

      {canWrite && (
        <p className="muted">
          Have a published competition itinerary?{" "}
          <Link href={`/${slug}/comms/shifts/suggest`}>Suggest shifts from it →</Link>
        </p>
      )}

      {/* The one page that mints the parent-facing signup link (FR-002 / §8a) —
          director/admin only. The Comms landing reports whether a link is live
          and sends people here, because the raw URL is shown once and it has to
          be shown where the button was pressed. */}
      {canShare && season && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <h2>Open shifts anyone can browse</h2>
          {freshSignupShareUrl ? (
            <>
              <p className="muted">
                One page listing the open shifts for {season.label}, that anyone
                with the link can read. Copy it now — for privacy the URL is
                shown only this once (parents claim shifts from their own family
                link, not from here):
              </p>
              <code style={{ wordBreak: "break-all" }}>{freshSignupShareUrl}</code>
            </>
          ) : signupShareLinks.length > 0 ? (
            <p className="muted">
              A link is live for {season.label}. The URL is only shown once, when
              it&apos;s made — make a new one to get a copyable link again (the
              old one stops working). Live links are listed in{" "}
              <Link href={`/${slug}/settings`}>Settings → Share links</Link>.
            </p>
          ) : (
            <p className="muted">
              No link yet. Make one and anyone you send it to can read this
              season&apos;s open shifts — a booster newsletter, a class group.
            </p>
          )}
          <form action={regenerateSignupShareLink}>
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="seasonId" value={season.id} />
            <button type="submit" className="secondary">
              {signupShareLinks.length > 0 ? "Make a new link" : "Make the link"}
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

      {shifts.map((s) => (
        <ShiftCard
          key={s.id}
          programId={program.id}
          slug={slug}
          tz={tz}
          shift={s}
          attach={attachLabel(s)}
          signups={signupsByShift.get(s.id) ?? []}
          confirmedCount={confirmedByShift.get(s.id) ?? 0}
          canWrite={canWrite}
          open={openId === s.id}
          error={openId === s.id ? rowError : null}
        />
      ))}
    </section>
  );
}
