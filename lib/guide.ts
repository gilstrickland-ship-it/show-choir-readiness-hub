import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";
import type { FlagKey } from "@/lib/flags";

// First-use guide (spec 003-first-use-tours). Role-shaped first-use guidance that
// steps a new user through the tool, completes itself from LIVE data (never a
// stored timestamp), never nags a returning user, and can be re-triggered on
// demand. Constitution touchpoints: server components/actions only; flag-gated
// exposure (`guide`); no third-party tour library; per-person state on the
// program_members.guide_state jsonb (0014).
//
// This module carries no top-level "use server": it exports pure helpers +
// typed journey definitions (imported by the Today page AND the unit tests) and,
// separately, two inline-"use server" guarded actions. The pure pieces are unit-
// tested; the actions guard writes with an explicit own-membership check via the
// service-role client (program_members has no self-update RLS policy, so the
// guarded action is the write path — defense in depth, same idiom as the token
// routes).

// ---------------------------------------------------------------------------
// State model (spec §1) — all keys optional. NO completion timestamps: step
// completion is always derived from live data at render.
// ---------------------------------------------------------------------------

export interface GuideState {
  journey_dismissed?: boolean;
  strips?: Record<string, boolean>;
}

// Tolerant parse of the raw jsonb column into a typed GuideState. Anything
// unexpected collapses to an empty state (the guide simply shows) rather than
// throwing — a malformed preference must never break the Today page.
export function parseGuideState(raw: unknown): GuideState {
  if (raw == null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: GuideState = {};
  if (obj.journey_dismissed === true) out.journey_dismissed = true;
  if (obj.strips != null && typeof obj.strips === "object") {
    const strips: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(obj.strips as Record<string, unknown>)) {
      if (v === true) strips[k] = true;
    }
    if (Object.keys(strips).length > 0) out.strips = strips;
  }
  return out;
}

// True when a surface's intro strip has been collapsed for this member.
export function isStripCollapsed(state: GuideState, key: StripSurfaceKey): boolean {
  return state.strips?.[key] === true;
}

// ---------------------------------------------------------------------------
// Strip-surface registry (spec §3) — KEYS ONLY for this wave. The eight complex
// surfaces that carry an intro strip. The strips themselves (copy + placement +
// "?" re-triggers) land in the next wave (T059); the registry + the guarded
// strips[key] setter ship now so the plumbing is complete.
// ---------------------------------------------------------------------------

export const STRIP_SURFACE_KEYS = [
  "treasury",
  "budget",
  "itinerary_editor",
  "packet_review",
  "trip",
  "hosting_event",
  "import",
  "digest",
] as const;

export type StripSurfaceKey = (typeof STRIP_SURFACE_KEYS)[number];

export function isStripSurfaceKey(key: string): key is StripSurfaceKey {
  return (STRIP_SURFACE_KEYS as readonly string[]).includes(key);
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

interface StepDef {
  label: string;
  hint?: string;
  hrefSuffix: string; // appended to `/${slug}`
  verify: (ctx: VerifyCtx) => Promise<boolean>;
}

interface JourneyDef {
  kind: JourneyKind;
  heading: string;
  lede?: string;
  steps: StepDef[]; // empty for the board orientation card
  // Board orientation card (no tasks): link rows + a single sentence.
  boardLinks?: { label: string; hrefSuffix: string }[];
  boardNote?: string;
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
      label: "Add your first competition",
      hrefSuffix: "/competitions",
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
      label: "Publish the itinerary",
      hrefSuffix: "/competitions",
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

const TREASURER_JOURNEY: JourneyDef = {
  kind: "treasurer",
  heading: "Set up the books",
  lede: "Four steps and the ledger is live, transparent, and audit-clean.",
  steps: [
    {
      label: "Open a budget from a template",
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
      label: "Record your first entry",
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
      label: "Attach a receipt",
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
      label: "Group them into a set",
      hrefSuffix: "/costumes/sets",
      verify: async (ctx) => {
        if (!ctx.seasonId) return false;
        const { count } = await ctx.supabase
          .from("costume_sets")
          .select("id", { count: "exact", head: true })
          .eq("program_id", ctx.programId)
          .eq("season_id", ctx.seasonId);
        return (count ?? 0) > 0;
      },
    },
    {
      label: "Assign pieces to students",
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

// Board member: an orientation card (not tasks). "Your seat sees everything and
// changes nothing — that transparency protects the program."
const BOARD_JOURNEY: JourneyDef = {
  kind: "board",
  heading: "Where everything lives",
  steps: [],
  boardLinks: [
    { label: "Money — the full ledger", hrefSuffix: "/treasury" },
    { label: "Budget vs actual", hrefSuffix: "/treasury/budget-vs-actual" },
    { label: "Reports & board snapshot", hrefSuffix: "/treasury/reports" },
    { label: "Season calendar", hrefSuffix: "/season" },
  ],
  boardNote:
    "Your seat sees everything and changes nothing — that transparency protects the program.",
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
  boardNote?: string;
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
      boardLinks: (def.boardLinks ?? []).map((l) => ({
        label: l.label,
        href: base + l.hrefSuffix,
      })),
      boardNote: def.boardNote,
      doneCount: 0,
      total: 0,
      state: "full",
      takeover: false,
      slug,
    };
  }

  // Task journeys. Gone when dismissed and not re-opened.
  if (dismissed && !forceOpen) return null;

  const ctx: VerifyCtx = { supabase, programId, seasonId };

  // Terminal short-circuit: an established program that reached the last
  // milestone is past setup — hide the panel without running any earlier query.
  if (!forceOpen) {
    const terminalDone = await def.steps[def.steps.length - 1].verify(ctx);
    if (terminalDone) return null;
  }

  // Panel will render: resolve every step's done state (independent queries).
  const doneArr = await Promise.all(def.steps.map((s) => s.verify(ctx)));
  const steps: JourneyStepView[] = def.steps.map((s, i) => ({
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
// Guarded state writes (spec §1). program_members has no self-update RLS policy,
// so these run through the service-role client with an explicit ownership check:
// the session user must own the membership row being updated. That check is the
// security boundary (same idiom as the token routes). Inline "use server" keeps
// this module importable by the Today page and the unit tests while still
// registering these two functions as server actions.
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

// Collapse an intro strip for a surface (strips[key] = true), then return to the
// surface with no querystring residue. Wired now; the strips themselves render
// in T059.
export async function setStripCollapsed(formData: FormData): Promise<void> {
  "use server";
  const { redirect } = await import("next/navigation");
  const { revalidatePath } = await import("next/cache");

  const programId = String(formData.get("programId") ?? "");
  const key = String(formData.get("key") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "");

  if (!isStripSurfaceKey(key)) {
    // An unknown surface key is a programming error, not a user path — no-op back.
    if (redirectTo.startsWith("/")) redirect(redirectTo);
    return;
  }

  await mutateOwnGuideState(programId, (state) => {
    const strips = { ...(state.strips ?? {}) };
    strips[key] = true;
    return { ...state, strips };
  });

  if (redirectTo.startsWith("/")) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
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
