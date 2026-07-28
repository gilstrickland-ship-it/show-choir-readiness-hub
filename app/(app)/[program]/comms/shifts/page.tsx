import Link from "next/link";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { requireFlag } from "@/lib/require-flag";
import { createClient } from "@/lib/supabase/server";
import { COMMS_ROLES, SETTINGS_ROLES } from "@/lib/nav";
import { SHIFT_WRITE_ROLES } from "@/lib/shifts";
import { activeShareLinks, shareLinkUrl } from "@/lib/tokens";
import { SubTabs } from "../../SubTabs";
import { commsTabs } from "@/lib/subnav";
import { AddShift, type NamedOption } from "./AddShift";
import { ShiftCard, type ShiftRow, type SignupRow } from "./ShiftCard";
import { regenerateSignupShareLink } from "./actions";
import { ShareLinkCard } from "../../ShareLinkCard";
import { Flash } from "../../Flash";
import { readFlash, oneParam, type PageFlash } from "@/lib/flash";
import { SHIFT_FLASH_MAPS, type ShiftSection } from "./shared";

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
  const one = (key: string): string | null => oneParam(sp, key);

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

  // One `?ok=` and one `?error=`, each resolving to the SECTION that owns the
  // message (shared.ts). `?edit=<shiftId>` says WHICH row a row-owned message
  // belongs to; a row-addressed code whose row is not on this page (a deleted
  // shift, a season switch) would render nowhere at all, so it falls back to
  // the page banner instead.
  const flash = readFlash<ShiftSection>(sp, SHIFT_FLASH_MAPS);
  const openId = canWrite ? one("edit") : null;
  const rowOnPage = !!openId && shifts.some((s) => s.id === openId);
  const errSection = flash.error?.section ?? null;
  const rowOwned = errSection === "panel" || errSection === "signup";
  const stranded = rowOwned && !rowOnPage;
  const pageFlash: PageFlash<ShiftSection> = stranded
    ? { ok: flash.ok, error: { section: "page", message: flash.error!.message } }
    : flash;
  const panelError =
    !stranded && errSection === "panel" ? (flash.error?.message ?? null) : null;
  const signupError =
    !stranded && errSection === "signup" ? (flash.error?.message ?? null) : null;
  // A create that came back rejected reopens the drawer with its message inside,
  // rather than dropping it at the top of a page the drawer is closed over.
  const drawerError =
    errSection === "drawer" ? (flash.error?.message ?? null) : null;

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

      <SubTabs
        strip={commsTabs(slug, "shifts", {
          digestEnabled: flags.digest,
          announcementsEnabled: flags.announcements,
          shiftsEnabled: true,
        })}
      />

      <Flash flash={pageFlash} section="page" />

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
        <ShareLinkCard
          resource="signup_page"
          programId={program.id}
          slug={slug}
          subject={season.label}
          resourceIdField={{ name: "seasonId", value: season.id }}
          action={regenerateSignupShareLink}
          liveCount={signupShareLinks.length}
          freshUrls={freshSignupShareUrl ? [freshSignupShareUrl] : null}
        />
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
          open={openId === s.id && !!panelError}
          error={openId === s.id ? panelError : null}
          signupError={openId === s.id ? signupError : null}
        />
      ))}
    </section>
  );
}
