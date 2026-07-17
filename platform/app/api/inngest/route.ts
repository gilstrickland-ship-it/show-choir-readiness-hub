// Inngest serve handler is wired in a later phase (packet/parse, digest/draft,
// digest/send, announcement/send, competition/seed, season/rollover-nudge).
// Stub only.

export async function GET() {
  return new Response("Inngest not configured yet.", { status: 501 });
}

export async function POST() {
  return new Response("Inngest not configured yet.", { status: 501 });
}

export async function PUT() {
  return new Response("Inngest not configured yet.", { status: 501 });
}
