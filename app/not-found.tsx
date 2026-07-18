import Link from "next/link";
import { brand } from "@/lib/brand";

// Root 404 (F4a). Renders inside the root layout for any unmatched route. Kept
// friendly and branded — no stack traces, no internal path echoes — and offers
// the two doors that always exist: the marketing home and the staff sign-in.

export default function NotFound() {
  return (
    <main className="auth stack">
      <h1>Page not found</h1>
      <p className="muted">
        We couldn&apos;t find that page on {brand.name}. It may have moved, or the
        link may be out of date.
      </p>
      <p className="stack" style={{ gap: "0.5rem" }}>
        <Link href="/">Go to the {brand.name} home page</Link>
        <Link href="/sign-in">Staff sign-in</Link>
      </p>
      <p className="muted">
        Still stuck? Email{" "}
        <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
      </p>
    </main>
  );
}
