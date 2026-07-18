import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySvix } from "@/lib/svix";

// Inbound packet-forward ingestion (§14.3, T026). A director forwards a host
// packet email to `packets+<program-slug>@<domain>`; Resend inbound POSTs it here
// and we land the PDF/image attachments in the documents bucket + a documents row
// (kind 'host_packet') for that program.
//
// CHOICE (documented): we resolve the program from the To-address ALIAS
// `packets+<slug>@` — it is self-describing and needs no sender lookup, so a
// director whose personal email isn't a program_member can still forward. (The
// alternative — matching the sender to a program_member — is ambiguous when a
// director runs multiple programs; the alias disambiguates.) The local part base
// ("packets") is env INBOUND_PACKETS_ADDRESS.
//
// UNMATCHED COMPETITION: packet_parses.competition_id is NOT NULL and the review
// screen needs competition context, so we DO NOT create a parse here. The document
// lands unattached (competition_id null); the competitions page shows an
// "unattached packets" list where a director attaches it to a competition, which
// then enqueues the existing parse pipeline. Simple and honest.
//
// SIGNATURE: verified via svix when RESEND_WEBHOOK_SECRET is set; soft-accepted
// otherwise (dev/pilot). Forging only uploads a document a human must still review
// and attach, so soft-accept is bounded-risk.

export const runtime = "nodejs";

interface InboundAttachment {
  filename?: string;
  content?: string; // base64
  content_type?: string;
  contentType?: string;
}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function extFor(contentType: string, filename: string): string | null {
  if (contentType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) return "pdf";
  if (contentType === "image/png" || filename.toLowerCase().endsWith(".png")) return "png";
  if (contentType === "image/jpeg" || /\.jpe?g$/i.test(filename)) return "jpg";
  if (contentType === "image/webp" || filename.toLowerCase().endsWith(".webp")) return "webp";
  if (contentType === "image/gif" || filename.toLowerCase().endsWith(".gif")) return "gif";
  return null;
}

function allowed(contentType: string, filename: string): boolean {
  if (contentType === "application/pdf") return true;
  if (IMAGE_TYPES.has(contentType)) return true;
  return extFor(contentType, filename) !== null;
}

// Extract every string address from the payload's To field (string or array,
// possibly "Name <addr>") and pull the program slug from a `packets+<slug>@`
// local part.
function slugFromRecipients(data: Record<string, unknown>, base: string): string | null {
  const raws: string[] = [];
  const to = data.to;
  if (Array.isArray(to)) for (const t of to) if (typeof t === "string") raws.push(t);
  else if (typeof to === "string") raws.push(to);
  // Some inbound shapes use `recipient` or `envelope.to`.
  if (typeof data.recipient === "string") raws.push(data.recipient);
  const envelope = data.envelope as Record<string, unknown> | undefined;
  if (envelope && Array.isArray(envelope.to))
    for (const t of envelope.to) if (typeof t === "string") raws.push(t);

  const re = new RegExp(`${base}\\+([a-z0-9-]+)@`, "i");
  for (const raw of raws) {
    const addr = raw.includes("<") ? (raw.match(/<([^>]+)>/)?.[1] ?? raw) : raw;
    const m = addr.match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "packet";
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const ok = verifySvix({
      secret,
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      body,
      signatureHeader: req.headers.get("svix-signature"),
    });
    if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { type?: string; data?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const data = (payload.data ?? {}) as Record<string, unknown>;

  const base = process.env.INBOUND_PACKETS_ADDRESS || "packets";
  const slug = slugFromRecipients(data, base);
  if (!slug) {
    return NextResponse.json({ ok: true, matched: false, reason: "no packets+slug alias" });
  }

  const supabase = createAdminClient();
  const { data: progData } = await supabase
    .from("programs")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const programId = (progData as { id: string } | null)?.id ?? null;
  if (!programId) {
    return NextResponse.json({ ok: true, matched: false, reason: "unknown program" });
  }

  const attachments = Array.isArray(data.attachments)
    ? (data.attachments as InboundAttachment[])
    : [];

  let stored = 0;
  for (const att of attachments) {
    const contentType = att.content_type ?? att.contentType ?? "";
    const filename = att.filename ?? "packet";
    if (!att.content || !allowed(contentType, filename)) continue;
    const ext = extFor(contentType, filename) ?? "pdf";

    let bytes: Buffer;
    try {
      bytes = Buffer.from(att.content, "base64");
    } catch {
      continue;
    }
    if (bytes.length === 0) continue;

    const path = `${programId}/inbound/${Date.now()}-${sanitizeName(filename)}`;
    const uploadType =
      ext === "pdf"
        ? "application/pdf"
        : contentType || `image/${ext === "jpg" ? "jpeg" : ext}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, bytes, { contentType: uploadType, upsert: false });
    if (upErr) continue;

    // competition_id null → unattached; a director attaches + parses from the
    // competitions page (parse needs competition context).
    const { error: docErr } = await supabase.from("documents").insert({
      program_id: programId,
      competition_id: null,
      kind: "host_packet",
      storage_path: path,
      uploaded_by: null,
    });
    if (!docErr) stored++;
  }

  return NextResponse.json({ ok: true, matched: true, stored });
}
