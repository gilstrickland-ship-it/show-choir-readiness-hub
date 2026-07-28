import Link from "next/link";
import type { PacketStep } from "@/lib/packet-pipeline";

// The shared packet-pipeline strip (spec 005 US7-4), rendered on all three
// surfaces the pipeline crosses: the packet page, the parse review screen, and
// the itinerary editor. Same component, same five steps, so "where am I?" has
// one answer wherever you are.
//
// A step that has a surface links to it; one that doesn't yet (a review screen
// with nothing to review) renders as plain text. Steps come from
// lib/packet-pipeline — this file only draws them.

const STATE_WORD: Record<string, string> = {
  done: "done",
  now: "you are here",
  blocked: "stuck",
  todo: "not yet",
};

export function PacketPipeline({ steps }: { steps: PacketStep[] }) {
  return (
    <nav className="packet-steps" aria-label="Packet steps">
      <ol>
        {steps.map((s) => {
          const body = (
            <>
              <span className="packet-step-mark" aria-hidden="true">
                {s.state === "done" ? "✓" : s.state === "blocked" ? "!" : "•"}
              </span>
              {s.label}
              <span className="packet-step-state"> — {STATE_WORD[s.state]}</span>
            </>
          );
          return (
            <li
              key={s.key}
              className={`packet-step ${s.state}`}
              aria-current={s.state === "now" ? "step" : undefined}
            >
              {s.href ? <Link href={s.href}>{body}</Link> : <span>{body}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
