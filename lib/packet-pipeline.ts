import type { SupabaseClient } from "@supabase/supabase-js";

// The packet → itinerary pipeline, as five steps (spec 005 US7-4).
//
// Getting a host packet in front of families is six decisions across three
// routes (packet upload, parse review, itinerary edit, publish), and nothing on
// those pages said where you were in it. This turns the state those pages ALREADY
// store — a host_packet document, the latest packet_parses row, the itinerary's
// status and item count — into one strip: Uploaded → Parsed → Reviewed → On
// itinerary → Published.
//
// Derived, never stored (no column, no migration, no behavior change): the same
// rows the three pages read anyway decide every step's state.

export type PacketStepState = "done" | "now" | "todo" | "blocked";

export interface PacketStep {
  key: string;
  label: string;
  state: PacketStepState;
  // Where the step is worked. Null when that surface can't be opened yet (a
  // review screen needs a parse to review).
  href: string | null;
}

export interface PacketPipelineState {
  uploaded: boolean;
  parseId: string | null;
  parseStatus: string | null;
  itemCount: number;
  published: boolean;
}

export interface PacketPipelineArgs {
  programId: string;
  competitionId: string;
  // The itinerary page has both of these in hand before it renders; passing them
  // skips the two itinerary round-trips this loader would otherwise repeat.
  itinerary?: { published: boolean; itemCount: number };
}

export async function loadPacketPipeline(
  supabase: SupabaseClient,
  { programId, competitionId, itinerary }: PacketPipelineArgs,
): Promise<PacketPipelineState> {
  const { data: docRow } = await supabase
    .from("documents")
    .select("id")
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .eq("kind", "host_packet")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: parseRow } = await supabase
    .from("packet_parses")
    .select("id, status")
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const parse = parseRow as { id: string; status: string } | null;

  let published = itinerary?.published ?? false;
  let itemCount = itinerary?.itemCount ?? 0;
  if (!itinerary) {
    const { data: itinRow } = await supabase
      .from("itineraries")
      .select("id, status")
      .eq("program_id", programId)
      .eq("competition_id", competitionId)
      .maybeSingle();
    const itin = itinRow as { id: string; status: string } | null;
    published = itin?.status === "published";
    if (itin) {
      const { count } = await supabase
        .from("itinerary_items")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId)
        .eq("itinerary_id", itin.id);
      itemCount = count ?? 0;
    }
  }

  return {
    uploaded: !!docRow,
    parseId: parse?.id ?? null,
    parseStatus: parse?.status ?? null,
    itemCount,
    published,
  };
}

// Turn the state into the five rendered steps. The first step that isn't done is
// the one you're on ("now"); a parse that failed is "blocked" — the strip stops
// pretending the next step is waiting on you when the pipeline is stuck.
export function packetPipelineSteps(
  state: PacketPipelineState,
  compBase: string,
): PacketStep[] {
  const reviewHref =
    state.parseId && (state.parseStatus === "review" || state.parseStatus === "accepted")
      ? `${compBase}/packet/${state.parseId}/review`
      : null;
  const parsed = state.parseStatus === "review" || state.parseStatus === "accepted";

  const done: { key: string; label: string; done: boolean; href: string | null }[] = [
    { key: "uploaded", label: "Uploaded", done: state.uploaded, href: `${compBase}/packet` },
    { key: "parsed", label: "Parsed", done: parsed, href: reviewHref ?? `${compBase}/packet` },
    { key: "reviewed", label: "Reviewed", done: state.parseStatus === "accepted", href: reviewHref },
    {
      key: "on-itinerary",
      label: "On itinerary",
      done: state.itemCount > 0,
      href: `${compBase}/itinerary`,
    },
    {
      key: "published",
      label: "Published",
      done: state.published,
      href: `${compBase}/itinerary`,
    },
  ];

  const firstOpen = done.findIndex((s) => !s.done);
  return done.map((s, i) => ({
    key: s.key,
    label: s.label,
    href: s.href,
    state: s.done
      ? "done"
      : state.parseStatus === "failed" && (s.key === "parsed" || s.key === "reviewed")
        ? "blocked"
        : i === firstOpen
          ? "now"
          : "todo",
  }));
}
