import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";
import type { FlagKey } from "@/lib/flags";

// First-use guide (spec 003-first-use-tours, re-derived against the rebuilt app
// in spec 005 Wave 9). Role-shaped first-use guidance that steps a new user
// through the tool, completes itself from LIVE data (never a stored timestamp),
// never nags a returning user, and can be re-triggered on demand. Constitution
// touchpoints: server components/actions only; flag-gated exposure (`guide`); no
// third-party tour library; per-person state on the program_members.guide_state
// jsonb (0014).
//
// WHAT WAVE 9 REMOVED, AND WHY. Spec 003 also shipped eight "intro strips" — a
// dismissible one-liner under the heading of the eight surfaces the pre-rebuild
// app found hard to read. Waves 1-14 rebuilt every one of those surfaces, and
// each rebuild put the strip's own sentences into the page as permanent copy:
// the Money page's eyebrow now says entries void and never delete, the itinerary
// says "Only staff can see this" beside a publish gate that spells out what
// publishing costs, the import page says Charms exports work as-is and health
// columns are refused, the packet review says nothing reaches a parent until you
// accept and publish. Every strip had become a second copy of a fact the page
// already stated — which is the layering RQ-6 forbids, and which the strips'
// own contract ("never duplicates the page's own copy") already forbade. So the
// registry, the strip component, the per-strip Got-it state and the `?help=1`
// re-trigger are gone rather than reworded. Guidance was the symptom; the
// rebuild treated the cause. The journey panel — which teaches a SEQUENCE no
// single page can state — stays, re-pointed at the rebuilt flows.
//
// This module carries no top-level "use server": it exports pure helpers +
// typed journey definitions (imported by the Today page AND the unit tests) and,
// separately, one inline-"use server" guarded action. The pure pieces are unit-
// tested; the action guards its write with an explicit own-membership check via
// the service-role client (program_members has no self-update RLS policy, so the
// guarded action is the write path — defense in depth, same idiom as the token
// routes).

// ---------------------------------------------------------------------------
// State model (spec §1) — all keys optional. NO completion timestamps: step
// completion is always derived from live data at render.
// ---------------------------------------------------------------------------

export interface GuideState {
  journey_dismissed?: boolean;
}

// Tolerant parse of the raw jsonb column into a typed GuideState. Anything
// unexpected collapses to an empty state (the guide simply shows) rather than
// throwing — a malformed preference must never break the Today page. Rows
// written before Wave 9 may still carry a `strips` object; it is simply not
// read, so an old preference is inert rather than an error.
export function parseGuideState(raw: unknown): GuideState {
  if (raw == null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: GuideState = {};
  if (obj.journey_dismissed === true) out.journey_dismissed = true;
  return out;
}

// ---------------------------------------------------------------------------
// Journey definitions (spec §2) — four role shapes. Each task step is a label +
// hint + link + a data-derived verifier (an independent existence/count query).
// A journey is resolved from the member's CURRENT role (a re-roled member sees
// the new role's journey), gated by the owning feature flag where noted.
// ---------------------------------------------------------------------------

export type JourneyKind = "director" | "treasurer" | "costume" | "board";

interface VerifyCtx {
  supabase: SupabaseClient;
  programId: string;
  seasonId: string | null;
}

// What a link in this panel needs to be true before it is offered. A flag-gated
// route 404s server-side (Constitution VIII), so a link the guide shows whose
// flag is off is a guide that ends in a dead end — it is dropped instead.
//
// Two shapes, because the app has two shapes of gate: a route behind ONE flag
// (`requireFlag`, or several of them in a row) and the Season union surface,
// which 404s only when EVERY absorbed flag is off. `flagsAny` is the same field
// lib/nav.ts uses for exactly that slot; both halves must pass.
interface LinkGate {
  flags?: readonly FlagKey[];
  flagsAny?: readonly FlagKey[];
}

function gatePasses(
  gate: LinkGate,
  flags: Record<FlagKey, boolean>,
): boolean {
  if (gate.flags && !gate.flags.every((key) => flags[key])) return false;
  if (gate.flagsAny && !gate.flagsAny.some((key) => flags[key])) return false;
  return true;
}

interface StepDef extends LinkGate {
  label: string;
  hint?: string;
  hrefSuffix: string; // appended to `/${slug}`
  verify: (ctx: VerifyCtx) => Promise<boolean>;
}

interface BoardLinkDef extends LinkGate {
  label: string;
  hrefSuffix: string;
}

// A closing line on the board card. Gated exactly like a link, because a note
// can name a capability that only exists when a feature is on.
interface BoardNoteDef extends LinkGate {
  text: string;
}

interface JourneyDef {
  kind: JourneyKind;
  heading: string;
  lede?: string;
  steps: StepDef[]; // empty for the board orientation card
  // Board orientation card (no tasks): link rows + closing sentences.
  boardLinks?: BoardLinkDef[];
  boardNotes?: BoardNoteDef[];
  // A non-step footer pointer (treasurer's board-snapshot nudge).
  footer?: { text: string; hrefSuffix: string };
}

// The director/admin journey (spec §2). Heading + step-1 label preserve the
// Wave-D setup-guide e2e contract ("Set up your program" / "Start your season").
const DIRECTOR_JOURNEY: JourneyDef = {
  kind: "director",
  heading: "Set up your program",
  lede:
    "A few steps and you're ready. Takes about ten minutes with the spreadsheet you already have.",
  steps: [
    {
      // Points at Season, where the one-submit "Start your season" card lives
      // (spec 005 US3). The rollover wizard is still reachable from that card
      // and from Settings; it is for year-over-year rollover, not first runs.
      label: "Start your season",
      hrefSuffix: "/season",
      flagsAny: ["competitions", "events", "travel", "archive"],
      verify: async (ctx) => ctx.seasonId != null,
    },
    {
      label: "Add your students",
      hint: "Import a spreadsheet, or add them one at a time.",
      hrefSuffix: "/roster/import",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("status", "active");
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Put students in an ensemble",
      hrefSuffix: "/roster/ensembles",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("ensemble_members")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      // The Season drawer is the create path now (spec 005 US1): `?add=comp`
      // opens Season with the Competition section already unfolded. The
      // /competitions list still exists, but its own "+ Add a competition"
      // button links HERE — so sending a first-run director to the list taught
      // a route that is no longer in the nav and cost her a second click to
      // arrive at the same drawer.
      label: "Add your first competition",
      hint: "+ Add on the Season page — a name and a date is enough.",
      hrefSuffix: "/season?add=comp",
      // Season is any-of gated, but the drawer only offers the Competition
      // section when `competitions` is on, so this step needs that flag
      // specifically (spec 005 T160 found the same class on the old link).
      flags: ["competitions"],
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("competitions")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      // Also Season: the spine's next-competition feature row carries an
      // "Itinerary" button, so a program with one competition is one click from
      // the editor — fewer than the /competitions list this used to point at,
      // and it teaches the surface that is actually in the nav.
      label: "Publish the itinerary",
      hint: "Your next competition sits at the top of the season — open Itinerary, then publish.",
      hrefSuffix: "/season",
      flags: ["competitions"],
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        // Itineraries are scoped by competition; filter through an inner join to
        // the competition's season.
        const { count } = await ctx.supabase
          .from("itineraries")
          .select("id, competitions!inner(season_id)", {
            count: "exact",
            head: true,
          })
          .eq("program_id", ctx.programId)
          .eq("status", "published")
          .eq("competitions.season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Email families their links",
      hint: "Email links to all families — one click.",
      hrefSuffix: "/roster",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("guardian_tokens")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Send your first announcement",
      hrefSuffix: "/comms/announcements",
      // Two flags gate that route (spec 005 US9-4): `comms` for the surface and
      // `announcements` for the channel. Before `announcements` was wired to
      // anything, this step could not 404; now it can, and it was the journey's
      // TERMINAL step — so a program with the channel off met a dead end at the
      // one place the guide sends everyone last.
      flags: ["comms", "announcements"],
      verify: async (ctx) => {
        const [ann, dig] = await Promise.all([
          ctx.supabase
            .from("announcements")
            .select("id", { count: "exact", head: true })
            .eq("program_id", ctx.programId)
            .eq("status", "sent"),
          ctx.supabase
            .from("digests")
            .select("id", { count: "exact", head: true })
            .eq("program_id", ctx.programId)
            .eq("status", "sent"),
        ]);
        return (ann.count ?? 0) > 0 || (dig.count ?? 0) > 0;
      },
    },
  ],
};

// The treasurer journey walks the money in the order the money moves — planned,
// then promised, then spent, then checked. Wave 9 inserted the "promised" step:
// spec 006 gave this seat a whole layer it did not have before (purchase orders
// and expected money), and a checklist that went straight from the budget to the
// ledger taught a treasurer that a balance is what she has — which is the exact
// mistake commitments exists to stop.
const TREASURER_JOURNEY: JourneyDef = {
  kind: "treasurer",
  heading: "Set up the books",
  lede: "Five steps and the books are live, transparent, and ready for a board meeting.",
  steps: [
    {
      label: "Build your budget from the template",
      hint: "Create it, seed the usual categories, then activate it — one active budget per season.",
      hrefSuffix: "/treasury/budget",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("budgets")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId)
          .eq("status", "active");
        return (count ?? 0) > 0;
      },
    },
    {
      // Spec 006. A treasurer may raise one herself (COMMITMENT_CREATE_ROLES);
      // approving her own is refused in the database, so this step is reachable
      // by her alone but never lets her sign both halves.
      label: "Write down what's already promised",
      hint: "Purchase orders and approved spending. Money promised but not yet paid never shows in the balance — it lives here.",
      hrefSuffix: "/treasury/commitments",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("commitments")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Record your first entry",
      hint: "In or out, how much, who, and what for — everything else can wait.",
      hrefSuffix: "/treasury",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("ledger_entries")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .is("voided_at", null);
        return (count ?? 0) > 0;
      },
    },
    {
      // Renamed in Wave 9: a receipt goes on at the moment the entry is
      // recorded (or rides along through a void & redo). The old "Attach a
      // receipt" read as something you could do to an entry already filed,
      // which the 0002 freeze trigger has never allowed.
      label: "Record one with its receipt",
      hint: "The receipt attaches as you record it — a filed entry is never edited, only voided and redone.",
      hrefSuffix: "/treasury",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("ledger_entries")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .is("voided_at", null)
          .not("receipt_path", "is", null);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Mark a month reconciled",
      hint: "Compare a month to the bank statement, then say so — the board can see how current the books are.",
      hrefSuffix: "/treasury",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("ledger_reconciliations")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId);
        return (count ?? 0) > 0;
      },
    },
  ],
  footer: {
    text: "Before your next board meeting: download the board snapshot.",
    hrefSuffix: "/treasury/reports",
  },
};

const COSTUME_JOURNEY: JourneyDef = {
  kind: "costume",
  heading: "Set up the wardrobe",
  lede: "Get the closet into the system, then run checkout on comp day.",
  steps: [
    {
      label: "Add your pieces",
      hrefSuffix: "/costumes/inventory",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("costume_pieces")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId);
        return (count ?? 0) > 0;
      },
    },
    {
      // Two steps became one in Wave 9. Sets stopped being a tab of their own in
      // spec 005 US13 — making, renaming and deleting one lives on Assignments
      // now — so "group them into a set" and "assign pieces to students" pointed
      // at the same page, and the first was strictly implied by the second
      // (assignments cannot exist without a set). One merged surface, one step.
      label: "Make a set and assign it",
      hint: "A set is one look — the costume everyone wears for one part of the show.",
      hrefSuffix: "/costumes/assignments",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("costume_assignments")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Work the alterations queue",
      hint: "Alterations is where Wardrobe opens — it's the queue this seat works every week.",
      hrefSuffix: "/costumes",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("costume_assignments")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId)
          .in("alteration_status", ["in_progress", "done"]);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Run checkout on comp day",
      hint: "The quick-change sheet prints from here too.",
      hrefSuffix: "/costumes/checkout",
      verify: async (ctx) => {
        const { count } = await ctx.supabase
          .from("costume_checkouts")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .not("checked_out_at", "is", null);
        return (count ?? 0) > 0;
      },
    },
  ],
};

// Board member: an orientation card (not tasks).
//
// Its links carry gates for the same reason the steps do, and here it was not a
// hypothetical: `treasury` is OFF for the whole prep tier, so a board member of
// any prep program opened Today and was handed a card whose first three rows —
// three quarters of the card — were 404s (spec 005 T160). The card is where
// everything lives; it may only name what is there.
//
// Wave 9 added the Commitments row and made the closing line two GATED notes.
// "Your seat sees everything and changes nothing" stopped being true when spec
// 006 shipped: above a program's second-approver amount a commitment needs two
// approvals, and a board member may record the first (COMMITMENT_APPROVE_ROLES).
// That is the single thing this seat can move, and the card that claims to say
// where everything lives cannot be the one screen that hides it — but it must
// not promise it either to a program whose money surface is switched off, which
// is why the second note carries the same `treasury` gate its links do.
const BOARD_JOURNEY: JourneyDef = {
  kind: "board",
  heading: "Where everything lives",
  steps: [],
  boardLinks: [
    {
      label: "Money — the full ledger",
      hrefSuffix: "/treasury",
      flags: ["treasury"],
    },
    {
      label: "Commitments — promised, not yet paid",
      hrefSuffix: "/treasury/commitments",
      flags: ["treasury"],
    },
    {
      label: "Budget vs actual",
      hrefSuffix: "/treasury/budget-vs-actual",
      flags: ["treasury"],
    },
    {
      label: "Reports & board snapshot",
      hrefSuffix: "/treasury/reports",
      flags: ["treasury"],
    },
    {
      // Season is a UNION surface: it 404s only when every flag it absorbs is
      // off, so an any-of gate is the one that matches (lib/nav's Season slot).
      label: "Season calendar",
      hrefSuffix: "/season",
      flagsAny: ["competitions", "events", "travel", "archive"],
    },
  ],
  boardNotes: [
    {
      text: "Your seat sees everything and changes nothing — that transparency protects the program.",
    },
    {
      text: "One exception: a big enough commitment needs two approvals, and yours can be the first. The treasurer's is the one that finishes it.",
      flags: ["treasury"],
    },
  ],
};

// Resolve the journey definition for a member's current role, honoring the
// owning feature flag: treasurer/costume shapes require their flag AND the role
// to match (spec §2). Returns null when no journey applies.
export function journeyForRole(
  role: Role,
  flags: Record<FlagKey, boolean>,
): JourneyDef | null {
  switch (role) {
    case "director":
    case "admin":
      return DIRECTOR_JOURNEY;
    case "treasurer":
      return flags.treasury ? TREASURER_JOURNEY : null;
    case "costume_manager":
      return flags.costumes ? COSTUME_JOURNEY : null;
    case "board_member":
      return BOARD_JOURNEY;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Panel model + loader (spec §2). The loader owns the lean-by-construction
// short-circuit: it never runs a verifier when the panel could not render
// (dismissed, or — for task journeys — the TERMINAL step already passes, the
// established-program signal, mirroring the Wave-D setup guide's short-circuit).
// ---------------------------------------------------------------------------

export interface JourneyStepView {
  label: string;
  hint?: string;
  href: string;
  done: boolean;
}

export type PanelState = "full" | "pill";

export interface JourneyPanelModel {
  kind: JourneyKind;
  heading: string;
  lede?: string;
  steps: JourneyStepView[]; // empty for the board card
  boardLinks?: { label: string; href: string }[];
  boardNotes?: string[];
  footer?: { text: string; href: string };
  doneCount: number;
  total: number;
  state: PanelState;
  // True only for a task journey in its full, materially-incomplete state — it
  // takes over the Today body exactly as the Wave-D setup guide did. Board cards
  // and re-opened (?guide=open) panels never take over; they sit above Today.
  takeover: boolean;
  slug: string;
}

// Decide the visible state from progress + whether this is an explicit re-open.
// Simplification (spec §2): full panel while <2 steps complete; pill otherwise.
// A re-open (?guide=open) or an all-complete revisit always shows the full panel.
export function panelStateFor(
  doneCount: number,
  total: number,
  forceOpen: boolean,
): PanelState {
  const allDone = total > 0 && doneCount === total;
  if (forceOpen || allDone || doneCount < 2) return "full";
  return "pill";
}

export async function loadJourneyPanel(
  supabase: SupabaseClient,
  args: {
    role: Role;
    flags: Record<FlagKey, boolean>;
    programId: string;
    seasonId: string | null;
    slug: string;
    guideState: GuideState;
    forceOpen: boolean;
  },
): Promise<JourneyPanelModel | null> {
  const { role, flags, programId, seasonId, slug, guideState, forceOpen } = args;
  const def = journeyForRole(role, flags);
  if (!def) return null;

  const dismissed = guideState.journey_dismissed === true;
  const base = `/${slug}`;

  // Board orientation card — no verifiers, no takeover. Gone when dismissed
  // (unless explicitly re-opened).
  if (def.kind === "board") {
    if (dismissed && !forceOpen) return null;
    return {
      kind: "board",
      heading: def.heading,
      lede: def.lede,
      steps: [],
      boardLinks: (def.boardLinks ?? [])
        .filter((l) => gatePasses(l, flags))
        .map((l) => ({
          label: l.label,
          href: base + l.hrefSuffix,
        })),
      boardNotes: (def.boardNotes ?? [])
        .filter((n) => gatePasses(n, flags))
        .map((n) => n.text),
      doneCount: 0,
      total: 0,
      state: "full",
      takeover: false,
      slug,
    };
  }

  // Task journeys. Gone when dismissed and not re-opened.
  if (dismissed && !forceOpen) return null;

  // Steps whose destination is flagged off are dropped BEFORE anything else
  // runs, so the terminal short-circuit reads the terminal step this member can
  // actually reach — not one whose link would 404 on them.
  const stepDefs = def.steps.filter((s) => gatePasses(s, flags));
  if (stepDefs.length === 0) return null;

  const ctx: VerifyCtx = { supabase, programId, seasonId };

  // Terminal short-circuit: an established program that reached the last
  // milestone is past setup — hide the panel without running any earlier query.
  if (!forceOpen) {
    const terminalDone = await stepDefs[stepDefs.length - 1].verify(ctx);
    if (terminalDone) return null;
  }

  // Panel will render: resolve every step's done state (independent queries).
  const doneArr = await Promise.all(stepDefs.map((s) => s.verify(ctx)));
  const steps: JourneyStepView[] = stepDefs.map((s, i) => ({
    label: s.label,
    hint: s.hint,
    href: base + s.hrefSuffix,
    done: doneArr[i],
  }));
  const doneCount = doneArr.filter(Boolean).length;
  const total = steps.length;
  const state = panelStateFor(doneCount, total, forceOpen);
  const allDone = doneCount === total;
  const takeover = state === "full" && !forceOpen && !allDone;

  return {
    kind: def.kind,
    heading: def.heading,
    lede: def.lede,
    steps,
    footer: def.footer
      ? { text: def.footer.text, href: base + def.footer.hrefSuffix }
      : undefined,
    doneCount,
    total,
    state,
    takeover,
    slug,
  };
}

// ---------------------------------------------------------------------------
// Guarded state write (spec §1). program_members has no self-update RLS policy,
// so this runs through the service-role client with an explicit ownership check:
// the session user must own the membership row being updated. That check is the
// security boundary (same idiom as the token routes). Inline "use server" keeps
// this module importable by the Today page and the unit tests while still
// registering the function as a server action.
// ---------------------------------------------------------------------------

// Read-modify-write a member's guide_state through the service-role client after
// confirming the session user owns the row. Returns nothing; throws on a missing
// session or membership (a "should never happen" — the UI only renders these
// controls to a signed-in member).
async function mutateOwnGuideState(
  programId: string,
  mutate: (state: GuideState) => GuideState,
): Promise<void> {
  const { getSessionUser } = await import("@/lib/auth");
  const { createAdminClient } = await import("@/lib/supabase/admin");

  const user = await getSessionUser();
  if (!user) throw new Error("Not authenticated");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("program_members")
    .select("id, guide_state")
    .eq("program_id", programId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!row) throw new Error("No active membership for this program");

  const next = mutate(parseGuideState((row as { guide_state: unknown }).guide_state));
  await admin
    .from("program_members")
    .update({ guide_state: next })
    .eq("id", (row as { id: string }).id);
}

// Set or clear journey_dismissed, then return to Today. Dismiss lands on Today
// with no querystring; re-open (clear) lands on Today with ?guide=open so the
// panel shows even when the terminal short-circuit would otherwise hide it.
export async function setJourneyDismissed(formData: FormData): Promise<void> {
  "use server";
  const { redirect } = await import("next/navigation");
  const { revalidatePath } = await import("next/cache");

  const programId = String(formData.get("programId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const dismissed = String(formData.get("dismissed") ?? "") === "1";

  await mutateOwnGuideState(programId, (state) => {
    const next: GuideState = { ...state };
    if (dismissed) next.journey_dismissed = true;
    else delete next.journey_dismissed;
    return next;
  });

  revalidatePath(`/${slug}/dashboard`);
  redirect(dismissed ? `/${slug}/dashboard` : `/${slug}/dashboard?guide=open`);
}

// Read the current member's guide_state (their own program_members row) via the
// caller's RLS client — a member can read their own row under the existing
// program_members read policy. Returns an empty state when absent (e.g. support
// views, which have no membership row).
export async function loadGuideState(
  supabase: SupabaseClient,
  programId: string,
  userId: string,
): Promise<GuideState> {
  const { data } = await supabase
    .from("program_members")
    .select("guide_state")
    .eq("program_id", programId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return parseGuideState((data as { guide_state?: unknown } | null)?.guide_state);
}
