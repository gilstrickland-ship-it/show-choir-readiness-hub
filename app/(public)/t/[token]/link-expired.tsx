import { brand } from "@/lib/brand";

// Shown by the token layout (F4b) when a /t/[token] link can't be resolved —
// invalid, revoked, or rotated. Deliberately PII-free and structure-blind: it
// never says whether the token ever existed, only that THIS link is inactive and
// how the parent gets a working one. Links rotate whenever staff resend them, so
// the most-recent email always holds the live link.

export function LinkExpired() {
  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto", padding: "1rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "1.05rem" }}>{brand.name}</strong>
      </header>
      <main style={{ padding: 0 }} className="stack">
        <h1>This link is no longer active</h1>
        <p>
          For your privacy, these links rotate — each time the program resends an
          email, the previous link stops working.
        </p>
        <p>
          Open the link in your <strong>most recent email</strong> from the
          program. If you can&apos;t find it, contact the program directly and ask
          them to resend it.
        </p>
        <p className="muted">
          Powered by {brand.name}. We can&apos;t look up personal information from
          this page.
        </p>
      </main>
    </div>
  );
}
