import Link from "next/link";
import { brand } from "@/lib/brand";

// Settings § Email health (F1; spec 005 Wave 13 / T164) — can this program
// actually reach its families?
//
// Presence booleans only, evaluated server-side by lib/email's `emailHealth()`:
// an env VALUE is never read into this page, so a key cannot be leaked by a
// screenshot of Settings. Nothing here is a mutation — the fixes belong to
// whoever hosts the deployment — so this section carries no disclosure and no
// message area; it states what is true and says who can change it.

export interface EmailCheck {
  ok: boolean;
  label: string;
  detail: string;
}

export function EmailHealthSection({
  slug,
  checks,
  guardians,
}: {
  slug: string;
  checks: EmailCheck[];
  // A count is null when its read FAILED. "Every address is good" is a claim
  // about whether this program can reach its families, and it used to be built
  // out of a count coalesced to zero — so a failed read reassured the director.
  guardians: {
    ok: number | null;
    bounced: number | null;
    unsubscribed: number | null;
  };
}) {
  const failing = checks.filter((c) => !c.ok).length;
  const countsKnown =
    guardians.bounced !== null && guardians.unsubscribed !== null;
  const needsAttention = countsKnown
    ? guardians.bounced! + guardians.unsubscribed!
    : null;
  const num = (n: number | null): string => (n === null ? "—" : String(n));
  const summary =
    failing > 0
      ? `${failing} of ${checks.length} checks need attention`
      : needsAttention === null
        ? "Set up · address health unknown"
        : needsAttention === 0
          ? "All clear"
          : `Set up · ${needsAttention} address${
              needsAttention === 1 ? "" : "es"
            } not receiving`;

  return (
    <section id="email-health" className="panel stack">
      <div className="travel-section-head">
        <h2>Email health</h2>
        <span className="travel-section-summary">{summary}</span>
      </div>
      <p className="muted">
        Whether {brand.name} can reliably reach families. These checks read your
        deployment&apos;s setup — no keys or secrets are ever shown here. A red
        dash means something the person who hosts your deployment needs to
        finish; nothing on this list is something you can fix from here.
      </p>
      <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
        {checks.map((c) => (
          <li key={c.label}>
            <strong>
              <span aria-hidden="true">{c.ok ? "✓ " : "– "}</span>
              {c.label} — {c.ok ? "OK" : "needs attention"}
            </strong>
            <br />
            <span className="muted">{c.detail}</span>
          </li>
        ))}
        <li>
          <strong>Guardian inbox health</strong>
          <br />
          <span className="muted">
            {num(guardians.ok)} receiving email · {num(guardians.bounced)}{" "}
            bounced · {num(guardians.unsubscribed)} unsubscribed.{" "}
            {needsAttention === null ? (
              <>
                These counts couldn&apos;t be read just now, so this is not a
                clean bill of health — reload to try again.
              </>
            ) : needsAttention > 0 ? (
              <Link href={`/${slug}/roster/email-issues`}>
                Review addresses that need attention
              </Link>
            ) : (
              "Every address is good."
            )}
          </span>
        </li>
      </ul>
    </section>
  );
}
