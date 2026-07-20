import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { TokenFooter } from "../parts";
import { unsubscribe } from "./actions";

// Tokenized unsubscribe (§8a, C1-4) — guardian tokens ONLY. Explains what stops,
// confirms with one button, and shows a resubscribe note. Share links get the
// standard "ask your director" treatment (they carry no email to stop). The
// mailbox-provider one-click path is the separate POST route at ./one-click.

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { token } = await params;
  const { s } = await searchParams;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  // Guardian tokens only — a shared browse link has no personal address to stop.
  if (resolved.kind !== "guardian") {
    return (
      <section className="stack">
        <h1>Unsubscribe</h1>
        <p className="muted">
          This is a shared browse link, so there&apos;s no personal email to
          unsubscribe here. If you&apos;re getting emails you&apos;d like to stop,
          use the Unsubscribe link at the bottom of one of those emails, or ask
          your director.
        </p>
        <TokenFooter token={token} kind="share" />
      </section>
    );
  }

  const email = resolved.guardian.email;

  if (s === "done") {
    return (
      <section className="stack">
        <h1>You&apos;re unsubscribed</h1>
        <p className="alert-ok">
          {email ? (
            <>
              We&apos;ve stopped announcements and weekly digests to{" "}
              <strong>{email}</strong>.
            </>
          ) : (
            <>We&apos;ve stopped announcements and weekly digests to your address.</>
          )}
        </p>
        <p className="muted">
          Changed your mind? The program can turn your emails back on — just
          contact your director and ask them to mark your address deliverable
          again.
        </p>
        <TokenFooter token={token} kind="guardian" />
      </section>
    );
  }

  const message =
    s === "ratelimited"
      ? "Too many requests — please wait a moment and try again."
      : s === "invalid"
        ? "That link is no longer valid."
        : null;

  return (
    <section className="stack">
      <h1>Unsubscribe</h1>
      {message && <p className="alert-error">{message}</p>}
      <p>
        Unsubscribing stops announcements and weekly digests to{" "}
        <strong>{email ?? "your address"}</strong>. Staff can still see that your
        address is unsubscribed.
      </p>
      <p className="muted">
        Your personal links keep working — you can still view the itinerary, sign
        up to volunteer, and report an absence. This only stops the program&apos;s
        outgoing emails to you.
      </p>
      <form action={unsubscribe} className="stack" style={{ width: "100%" }}>
        <input type="hidden" name="token" value={token} />
        <button type="submit">Unsubscribe this address</button>
      </form>
      <TokenFooter token={token} kind="guardian" />
    </section>
  );
}
