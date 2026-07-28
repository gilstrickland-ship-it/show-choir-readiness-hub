import type { RolloverProgress } from "@/lib/seasons";

// Where you are in the rollover (spec 005 Wave 13 / T165).
//
// The wizard used to say "Step 3 · Who is coming back" in a heading and nothing
// else: no total, no map, and — on the path where a program has nothing to carry
// across — a jump from "Step 1" straight to "Step 5". This is the honest version:
// the position and the total come from lib/seasons' derived sequence, and every
// step is listed so the two questions a director actually has ("how much of this
// is left?", "what is coming?") are answered without clicking anything.
//
// The states and their marks are the app's existing step-strip vocabulary (the
// packet pipeline and the roster import both read this way), so a director who
// has met one has met all three. It borrows that strip's CLASSES too —
// `.packet-steps` is written for exactly this and adding a third name to the
// selector list is a globals.css change, which this wave does not own.

const STATE_WORD: Record<string, string> = {
  done: "done",
  now: "you are here",
  todo: "not yet",
};

export function RolloverSteps({ progress }: { progress: RolloverProgress }) {
  return (
    <nav className="packet-steps" aria-label="Rollover steps">
      <ol>
        {progress.steps.map((s) => (
          <li
            key={s.key}
            className={`packet-step ${s.state}`}
            aria-current={s.state === "now" ? "step" : undefined}
          >
            <span className="packet-step-mark" aria-hidden="true">
              {s.state === "done" ? "✓" : "•"}
            </span>
            {s.label}
            <span className="packet-step-state"> — {STATE_WORD[s.state]}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// The one-line answer, for the section head beside the step's own title.
export function rolloverStepCaption(progress: RolloverProgress): string {
  return progress.finished
    ? "Done"
    : `Step ${progress.position} of ${progress.total}`;
}
