import Link from "next/link";
import type { PageFlash } from "@/lib/flash";
import { formatCents, type CommitmentThresholds } from "@/lib/treasury";
import { Flash } from "../Flash";
import { updateCommitmentThresholds } from "./actions";
import { SETTINGS_ANCHOR, type SettingsSection } from "./shared";

// Settings § Spending rules (spec 006 D6 / T177) — the three numbers that decide
// when one signature stops being enough.
//
// It is three numbers rather than a rules engine on purpose. Real purchasing
// policies vary too much between a 400-student district and a 40-student booster
// for a fixed ladder to fit either, and too little for anyone to sit down and
// configure a rules engine. Two of the three BLOCK and one only NUDGES, and the
// section says which is which out loud, because a rule a treasurer discovers by
// being refused is a rule she will route around next time.
//
// Written in the Wave-13 section idiom (a title, a live summary of what it
// currently says, mutations behind one labelled disclosure), so the answer to
// "what are our rules?" is readable without opening anything.
//
// Not the treasurer's to set — this whole page is director/admin, and that is
// the point rather than an accident: a treasurer who could raise her own
// second-approver amount would not be held to one.

export function SpendingRulesSection({
  slug,
  programId,
  flash,
  thresholds,
}: {
  slug: string;
  programId: string;
  flash: PageFlash<SettingsSection>;
  thresholds: CommitmentThresholds;
}) {
  // Zero is OFF, and it is said as "off" rather than as "$0.00" — which would
  // read as "every purchase needs a second approver", the opposite of the truth.
  const say = (cents: number): string => (cents > 0 ? formatCents(cents) : "off");
  const dollars = (cents: number): string => (cents / 100).toFixed(2);
  const facts = [
    `Second approver above ${say(thresholds.secondApproverCents)}`,
    `Board above ${say(thresholds.boardApprovalCents)}`,
    `Three quotes above ${say(thresholds.threeQuotesCents)}`,
  ];

  return (
    <section id={SETTINGS_ANCHOR.spending} className="panel stack">
      <div className="travel-section-head">
        <h2>Spending rules</h2>
        <span className="travel-section-summary">{facts.join(" · ")}</span>
      </div>
      <Flash flash={flash} section="spending" />
      <p className="muted">
        How big a purchase has to be before one person&apos;s approval stops
        being enough. These apply to{" "}
        <Link href={`/${slug}/treasury/commitments`}>commitments</Link> — money
        the program has promised — from the moment you save them. Nothing already
        approved changes.
      </p>

      <dl className="detail-list">
        <dt>Needs a second approver</dt>
        <dd>
          Above {say(thresholds.secondApproverCents)} · two people have to
          approve it, and neither of them can be whoever asked for it. The
          treasurer&apos;s approval is the one that finishes it, so somebody else
          — a director, an admin, or a board member — approves first.{" "}
          <strong>This one blocks.</strong>
        </dd>
        <dt>Needs board approval</dt>
        <dd>
          Above {say(thresholds.boardApprovalCents)} · the board minutes have to
          be written on the commitment before it can be issued.{" "}
          <strong>This one blocks.</strong>
        </dd>
        <dt>Get three quotes</dt>
        <dd>
          Above {say(thresholds.threeQuotesCents)} · the commitment says to get
          three quotes and where to record them.{" "}
          <strong>This one never blocks anything.</strong>
        </dd>
      </dl>

      <details className="stack">
        <summary className="people-disclosure">
          Change these amounts — {facts.join(" · ")}
        </summary>
        <form action={updateCommitmentThresholds} className="stack settings-form">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="slug" value={slug} />

          <p className="muted">
            Enter dollars. <strong>0 turns a rule off.</strong> A second-approver
            amount your program cannot actually staff is worse than none: if
            there is nobody besides the person asking and the treasurer, set it
            to 0 and say so in your minutes, rather than leaving purchases stuck.
          </p>

          <label>
            Needs a second approver above $
            <input
              type="text"
              name="second_approver"
              inputMode="decimal"
              defaultValue={dollars(thresholds.secondApproverCents)}
              aria-label="Second approver above"
            />
          </label>
          <label>
            Needs board approval above $
            <input
              type="text"
              name="board_approval"
              inputMode="decimal"
              defaultValue={dollars(thresholds.boardApprovalCents)}
              aria-label="Board approval above"
            />
          </label>
          <label>
            Get three quotes above $
            <input
              type="text"
              name="three_quotes"
              inputMode="decimal"
              defaultValue={dollars(thresholds.threeQuotesCents)}
              aria-label="Three quotes above"
            />
          </label>

          <button type="submit">Save spending rules</button>
        </form>
      </details>
    </section>
  );
}
