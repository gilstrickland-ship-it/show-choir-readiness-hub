import { describe, test, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadPacketPipeline,
  packetPipelineSteps,
  type PacketPipelineState,
} from "@/lib/packet-pipeline";

// The five-step packet indicator (spec 005 US7-4, T129). It reports state it did
// not create: every step is derived from rows the three packet surfaces already
// read. The load-bearing properties are (a) exactly one "now" step, (b) a failed
// parse reads as stuck rather than as "your turn", and (c) a step whose surface
// can't be opened yet carries no link.

const BASE = "/demo/competitions/c1";

function state(over: Partial<PacketPipelineState> = {}): PacketPipelineState {
  return {
    uploaded: false,
    parseId: null,
    parseStatus: null,
    itemCount: 0,
    published: false,
    ...over,
  };
}

describe("packetPipelineSteps", () => {
  test("names the five steps in pipeline order", () => {
    expect(packetPipelineSteps(state(), BASE).map((s) => s.label)).toEqual([
      "Uploaded",
      "Parsed",
      "Reviewed",
      "On itinerary",
      "Published",
    ]);
  });

  test("nothing uploaded: the first step is the one you're on", () => {
    const steps = packetPipelineSteps(state(), BASE);
    expect(steps.map((s) => s.state)).toEqual([
      "now",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  test("a parse waiting for review marks Uploaded/Parsed done and Reviewed now", () => {
    const steps = packetPipelineSteps(
      state({ uploaded: true, parseId: "p1", parseStatus: "review" }),
      BASE,
    );
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "now",
      "todo",
      "todo",
    ]);
    // Reviewed is reachable now, so it links to the review screen.
    expect(steps[2].href).toBe(`${BASE}/packet/p1/review`);
  });

  test("an accepted parse on a published itinerary is all done", () => {
    const steps = packetPipelineSteps(
      state({
        uploaded: true,
        parseId: "p1",
        parseStatus: "accepted",
        itemCount: 9,
        published: true,
      }),
      BASE,
    );
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  test("a queued parse has not parsed yet", () => {
    const steps = packetPipelineSteps(
      state({ uploaded: true, parseId: "p1", parseStatus: "queued" }),
      BASE,
    );
    expect(steps[1].state).toBe("now");
    // No review screen to open while the parse is still running.
    expect(steps[2].href).toBeNull();
  });

  test("a failed parse reads as stuck, and points at the manual way round it", () => {
    const steps = packetPipelineSteps(
      state({ uploaded: true, parseId: "p1", parseStatus: "failed" }),
      BASE,
    );
    expect(steps[1].state).toBe("blocked");
    expect(steps[2].state).toBe("blocked");
    // The manual path is still open: entering items by hand lands on itinerary.
    expect(steps[3].href).toBe(`${BASE}/itinerary`);
    // ...and it is where you ARE. Reading "you are here" as the first step that
    // isn't done put the cursor on a blocked step, so a stuck pipeline had no
    // current step at all and nothing told the director what to do next.
    expect(steps[3].state).toBe("now");
    expect(steps.filter((s) => s.state === "now")).toHaveLength(1);
  });

  // The documented recovery from a failed parse: type the itinerary in by hand.
  // Once it has items, the only thing left is to publish — and the strip has to
  // say so. It used to leave every step either done or blocked or "not yet",
  // which reads as "nothing is waiting on you" on a comp that is not published.
  test("after a failed parse is recovered by hand, Publish is where you are", () => {
    const steps = packetPipelineSteps(
      state({ uploaded: true, parseId: "p1", parseStatus: "failed", itemCount: 6 }),
      BASE,
    );
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "blocked",
      "blocked",
      "done",
      "now",
    ]);
  });

  test("a stuck pipeline that reached publication has no current step left", () => {
    const steps = packetPipelineSteps(
      state({
        uploaded: true,
        parseId: "p1",
        parseStatus: "failed",
        itemCount: 6,
        published: true,
      }),
      BASE,
    );
    expect(steps.filter((s) => s.state === "now")).toHaveLength(0);
  });

  test("hand-entered items count as on-itinerary even without a packet", () => {
    const steps = packetPipelineSteps(state({ itemCount: 4 }), BASE);
    expect(steps[3].state).toBe("done");
    expect(steps[4].state).toBe("todo");
  });
});

// ----------------------------------------------------------------------------
// Which parse the strip is about (review-screen fix)
// ----------------------------------------------------------------------------
// The packet and itinerary pages are about a COMPETITION, so they want its
// latest parse. The review screen is about ONE parse — the one in its URL — and
// deriving its strip from the latest instead printed "Parsed — stuck" across the
// top of an accepted draft the moment a later upload failed behind it.

describe("loadPacketPipeline: the parse the caller names wins", () => {
  // Chainable stub: every builder method returns itself, and awaiting a
  // maybeSingle() hands back the canned row for the last from(table).
  function fakeClient(rows: Record<string, unknown>) {
    const builder: Record<string, unknown> = {
      _table: "",
      from(t: string) {
        builder._table = t;
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows[builder._table as string] ?? null }),
    };
    return builder as unknown as SupabaseClient;
  }

  const canned = {
    documents: { id: "d1" },
    // The competition's LATEST parse — a re-upload that failed.
    packet_parses: { id: "p2", status: "failed" },
    itineraries: { id: "i1", status: "draft" },
  };

  test("without a parse, the latest one drives the strip", async () => {
    const state = await loadPacketPipeline(fakeClient(canned), {
      programId: "prog",
      competitionId: "comp",
      itinerary: { published: false, itemCount: 3 },
    });
    expect(state.parseId).toBe("p2");
    expect(state.parseStatus).toBe("failed");
  });

  test("the reviewed parse overrides the latest, and no query is spent on it", async () => {
    const state = await loadPacketPipeline(fakeClient(canned), {
      programId: "prog",
      competitionId: "comp",
      itinerary: { published: false, itemCount: 3 },
      parse: { id: "p1", status: "accepted" },
    });
    expect(state.parseId).toBe("p1");
    expect(state.parseStatus).toBe("accepted");
    // Which is the whole point: the strip on the accepted draft's review screen
    // says Reviewed, not "stuck".
    const steps = packetPipelineSteps(state, BASE);
    expect(steps[2].state).toBe("done");
    expect(steps.some((s) => s.state === "blocked")).toBe(false);
  });
});
