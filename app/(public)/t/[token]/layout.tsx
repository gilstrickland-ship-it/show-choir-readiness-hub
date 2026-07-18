import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { getResolvedToken, getClientIp, rateLimitRawToken } from "@/lib/public-token";
import { logTokenEvent } from "@/lib/tokens";
import "@/app/globals.css";

// Tokenized parent surface (§8a) — no auth, mobile-first, all times in program
// tz. The layout is the security gate for every /t/[token] page:
//   1. rate-limit (per-IP + per-token, §10) — over budget renders a 429 page;
//   2. resolve the token via the service-role client (RLS does not apply here);
//   3. 404 cleanly on invalid / revoked / expired — never reveal structure;
//   4. log a 'view' token_event (§10 audit).
// Pages re-read the resolved token via the request-cached getResolvedToken.

export default async function TokenLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ip = await getClientIp();
  const limit = rateLimitRawToken(ip, token);
  if (!limit.ok) {
    const secs = Math.ceil(limit.retryAfterMs / 1000);
    return (
      <TokenFrame>
        <h1>Slow down a moment</h1>
        <p>
          This link has been opened too many times in a short window. Please wait
          about {secs} second{secs === 1 ? "" : "s"} and try again.
        </p>
      </TokenFrame>
    );
  }

  const resolved = await getResolvedToken(token);
  if (!resolved) {
    notFound();
  }

  // Audit the view (best-effort — never blocks the render).
  await logTokenEvent({
    programId: resolved.program.id,
    kind: resolved.kind,
    tokenId: resolved.tokenId,
    action: "view",
    ip,
  });

  return (
    <TokenFrame programName={resolved.program.name}>{children}</TokenFrame>
  );
}

function TokenFrame({
  children,
  programName,
}: {
  children: React.ReactNode;
  programName?: string;
}) {
  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto", padding: "1rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "1.05rem" }}>{programName ?? brand.name}</strong>
        {programName && (
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {brand.name}
          </div>
        )}
      </header>
      <main style={{ padding: 0 }}>{children}</main>
    </div>
  );
}
