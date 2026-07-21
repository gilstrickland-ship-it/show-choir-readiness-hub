import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { recoverLinks } from "./actions";

// Self-service link recovery page (§8a, C2-3). A dedicated public page rather
// than a form mounted inside the token layout's LinkExpired screen: an expired
// token has no valid URL to post back to or show a result on, so a stable,
// token-free page is the clean home for the form and its completion message.
// Enumeration-safe: the same message shows whether or not the address matched.

export const metadata: Metadata = {
  title: `Get your links — ${brand.name}`,
};

export default async function LinkHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <div className="token-frame">
      <header className="token-header">
        <strong>{brand.name}</strong>
        <div className="token-header-cap">Get your family links · no account needed</div>
      </header>
      <main>
        <section className="stack">
          <h1>Get your family links</h1>

          {sent ? (
            <>
              <p className="alert-ok">
                If that address is on a program&apos;s contact list, an email with
                fresh links is on its way.
              </p>
              <p className="muted">
                It can take a few minutes to arrive. Check your spam folder, and
                open the link in the newest email — earlier links stop working.
              </p>
            </>
          ) : (
            <>
              <p>
                Deleted the email? Enter your email address and, if it&apos;s on a
                program&apos;s contact list, we&apos;ll send your family links.
              </p>
              <form action={recoverLinks} className="stack" style={{ width: "100%" }}>
                <label style={{ width: "100%" }}>
                  Email address
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <button type="submit">Send my links</button>
              </form>
              <p className="muted">
                For your privacy, we&apos;ll never say whether an address is on a
                list — you&apos;ll see the same confirmation either way.
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
