import { brand } from "@/lib/brand";

// Tokenized parent surface placeholder — no auth, mobile-first. The token layer
// (mint/hash/verify, capability allow-list) arrives in P7; this route resolves
// an opaque token to a family/resource then. URLs never carry PII.

export default async function TokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params;

  return (
    <main>
      <h1>{brand.name}</h1>
      <p>This link is not active yet.</p>
    </main>
  );
}
