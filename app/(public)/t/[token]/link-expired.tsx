import Link from "next/link";
import { brand } from "@/lib/brand";

// Shown by the token layout (F4b) when a /t/[token] link can't be resolved —
// invalid, revoked, or copied incompletely. Deliberately PII-free and
// structure-blind: it never says whether the token ever existed, only that THIS
// link is inactive and how the parent gets a working one. Guardian tokens are
// append-only (lib/tokens.ts): earlier links keep working until staff explicitly
// reset the family's links, and the links in the newest email always work — so
// the copy must NOT claim links auto-rotate on every resend (they don't).

export function LinkExpired() {
  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto", padding: "1rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "1.05rem" }}>{brand.name}</strong>
      </header>
      <main style={{ padding: 0 }} className="stack">
        <h1>This link is no longer active</h1>
        <p>
          It may have been reset by the program, or the address was copied
          incompletely. The links in your <strong>newest email</strong> from the
          program always work.
        </p>
        <p>
          Can&apos;t find that email? We can send your family a fresh set of
          links:
        </p>
        <p>
          <Link href="/link-help" className="token-btn dark" style={{ display: "inline-block" }}>
            Email me my links
          </Link>
        </p>
        <p className="muted">
          Powered by {brand.name}. We can&apos;t look up personal information from
          this page.
        </p>
      </main>
    </div>
  );
}
