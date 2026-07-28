import { describe, test, expect } from "vitest";
import {
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

  test("a failed parse reads as stuck, not as your turn", () => {
    const steps = packetPipelineSteps(
      state({ uploaded: true, parseId: "p1", parseStatus: "failed" }),
      BASE,
    );
    expect(steps[1].state).toBe("blocked");
    expect(steps[2].state).toBe("blocked");
    // The manual path is still open: entering items by hand lands on itinerary.
    expect(steps[3].href).toBe(`${BASE}/itinerary`);
    expect(steps.filter((s) => s.state === "now")).toHaveLength(0);
  });

  test("hand-entered items count as on-itinerary even without a packet", () => {
    const steps = packetPipelineSteps(state({ itemCount: 4 }), BASE);
    expect(steps[3].state).toBe("done");
    expect(steps[4].state).toBe("todo");
  });
});
