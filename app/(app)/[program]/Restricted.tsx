import Link from "next/link";
import { ROLE_LABELS, type Role } from "@/lib/auth";

// Friendly, data-free "this surface is outside your seat" notice, shown in place
// of a bare 404 when an authenticated program member direct-navigates to a
// surface their ROLE does not include (the nav already hides the link; this is
// the URL-typed / bookmarked case).
//
// This page INTENTIONALLY acknowledges that the surface exists and names the
// seats that own it. That is acceptable ONLY because the viewer is already an
// authenticated, active member of THIS program — no tenant boundary is crossed
// and nothing about a competitor program is revealed. Flag-disabled features
// (requireFlag) must NOT use this component: a program with a feature turned off
// must not learn the feature exists, so those keep hard-404ing via notFound().
//
// It renders NOTHING from the target surface — no data query runs — so a denied
// role learns only the seat map, never a single row of protected content.

// Natural-language list join ("A", "A and B", "A, B, and C") so the seat sentence
// reads like prose rather than a comma dump.
function joinSeatLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function Restricted({
  slug,
  surface,
  role,
  allowed,
}: {
  slug: string;
  surface: string;
  role: Role;
  allowed: readonly Role[];
}) {
  const roleLabel = ROLE_LABELS[role];
  const allowedLabels = allowed.map((r) => ROLE_LABELS[r]);
  const seatWord = allowed.length === 1 ? "seat" : "seats";

  return (
    <section className="auth restricted" aria-labelledby="restricted-heading">
      <p className="restricted-eyebrow">Restricted area</p>
      <h1 id="restricted-heading" className="restricted-heading">
        {surface} is outside your seat
      </h1>
      <p className="restricted-body">
        Nothing is broken and you haven&apos;t hit a dead end — your{" "}
        <strong>{roleLabel}</strong> seat simply doesn&apos;t include this area.{" "}
        {surface} is looked after by the {joinSeatLabels(allowedLabels)}{" "}
        {seatWord}.
      </p>
      <p className="restricted-body restricted-help">
        Think you need access? Ask your director to adjust your seat under
        Settings → Members.
      </p>
      <div className="restricted-actions">
        <Link href={`/${slug}/dashboard`} className="button-link accent">
          Back to Today
        </Link>
      </div>
    </section>
  );
}
