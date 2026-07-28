import Link from "next/link";
import type { JourneyPanelModel } from "@/lib/guide";
import { setJourneyDismissed } from "@/lib/guide";

// The one role-switched first-use journey panel (spec §2). Server component: it
// renders a plain model resolved by lib/guide.ts (loadJourneyPanel) and its only
// interactivity is a form posting to the guarded dismiss action. Three shapes:
//   • full   — the numbered checklist (same visual idiom as the Wave-D setup
//              guide; it reuses the .setup-guide/.setup-step classes so styling
//              and the onboarding e2e contract both hold).
//   • pill   — a slim one-row progress summary that expands to the full panel.
//   • board  — the board_member orientation card (link rows + closing notes,
//              both gated on the flags their subject needs).

function DismissForm({
  programId,
  slug,
  label,
  className,
}: {
  programId: string;
  slug: string;
  label: string;
  className: string;
}) {
  return (
    <form action={setJourneyDismissed}>
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="dismissed" value="1" />
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}

export function JourneyPanel({
  model,
  programId,
}: {
  model: JourneyPanelModel;
  programId: string;
}) {
  const { slug } = model;

  // --- Board orientation card ------------------------------------------------
  if (model.kind === "board") {
    return (
      <section className="setup-guide journey-board" aria-label={model.heading}>
        <h2>{model.heading}</h2>
        <div className="journey-board-links">
          {(model.boardLinks ?? []).map((l) => (
            <Link key={l.href} href={l.href} className="journey-board-link">
              {l.label}
            </Link>
          ))}
        </div>
        {(model.boardNotes ?? []).map((note, i) => (
          <p key={i} className="setup-lede">
            {note}
          </p>
        ))}
        <DismissForm
          programId={programId}
          slug={slug}
          label="Got it"
          className="button-link secondary journey-board-got-it"
        />
      </section>
    );
  }

  // --- Pill (slim progress row) ----------------------------------------------
  if (model.state === "pill") {
    return (
      <Link
        href={`/${slug}/dashboard?guide=open`}
        className="journey-pill"
        aria-label={`Getting started — ${model.doneCount} of ${model.total} done`}
      >
        <span className="journey-pill-label">Getting started</span>
        <span className="journey-pill-count">
          {model.doneCount} of {model.total}
        </span>
        <span className="journey-pill-cta">Continue →</span>
      </Link>
    );
  }

  // --- Full checklist --------------------------------------------------------
  return (
    <section className="setup-guide" aria-label={model.heading}>
      <h2>{model.heading}</h2>
      {model.lede && <p className="setup-lede">{model.lede}</p>}
      <ol className="setup-steps">
        {model.steps.map((step, i) => (
          <li key={i} className={`setup-step${step.done ? " done" : ""}`}>
            <span className="setup-step-num" aria-hidden="true">
              {step.done ? "✓" : i + 1}
            </span>
            <div className="setup-step-body">
              {step.done ? (
                <span className="setup-step-label">{step.label}</span>
              ) : (
                <Link href={step.href} className="setup-step-label">
                  {step.label}
                </Link>
              )}
              {step.hint && !step.done && (
                <div className="setup-step-hint">{step.hint}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {model.footer && (
        <p className="setup-step-hint journey-footer">
          {model.footer.text}{" "}
          <Link href={model.footer.href}>Board snapshot →</Link>
        </p>
      )}
      <DismissForm
        programId={programId}
        slug={slug}
        label="Hide this guide"
        className="linklike journey-hide"
      />
    </section>
  );
}
