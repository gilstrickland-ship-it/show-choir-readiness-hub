import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { brand } from "@/lib/brand";

// ============================================================================
// §8a Tokenized link layer — the parents' entire surface (Constitution II).
// ----------------------------------------------------------------------------
// Two token kinds:
//   • guardian_tokens — per-family, long-lived, identify WHO is acting.
//   • share_links     — broadcast, read-only, one token for everyone.
// Tokens are ≥128-bit random, hashed (sha256 hex) at rest — NO raw token column
// exists in the schema. A raw token is therefore only ever knowable at mint
// time; it lives in the email/URL, never in the database.
//
// The capability allow-list below is the security boundary for the anonymous
// token routes: RLS does not apply to anonymous visitors, so these surfaces run
// on the service-role client and every action is checked against this list. Keep
// it tiny and explicit — a leaked token exposes one family only.
//
// This module is NOT 'use server' (it exports constants + sync helpers). The
// pure parts (generateToken/hashToken/verifyToken/CAPABILITIES) carry no DB or
// env dependency so tests/unit covers them directly.
// ============================================================================

// ---- Capability allow-list (exhaustive) ------------------------------------
// Guardian tokens allow EXACTLY: view own students' costume assignment +
// alteration status; view published itineraries + open shifts for their family;
// claim/cancel own shift signups; submit an absence request for own student(s).
// The one write that touches operations (absence) lands in a staff review queue.
export const GUARDIAN_CAPABILITIES = [
  "costume:view",
  "itinerary:view",
  "signup:view",
  "shift:claim",
  "shift:cancel",
  "absence:submit",
] as const;

// Share links are read-only views of their one resource. Nothing else.
export const SHARE_CAPABILITIES = ["resource:view"] as const;

export const CAPABILITIES = {
  guardian: GUARDIAN_CAPABILITIES,
  share: SHARE_CAPABILITIES,
} as const;

export type GuardianCapability = (typeof GUARDIAN_CAPABILITIES)[number];
export type ShareCapability = (typeof SHARE_CAPABILITIES)[number];
export type TokenKind = keyof typeof CAPABILITIES;

// The only operations that write anything (defense-in-depth: every write path
// asserts one of these before touching the DB).
export const GUARDIAN_WRITE_CAPABILITIES = [
  "shift:claim",
  "shift:cancel",
  "absence:submit",
] as const;

export function guardianCan(capability: string): capability is GuardianCapability {
  return (GUARDIAN_CAPABILITIES as readonly string[]).includes(capability);
}

export function shareCan(capability: string): capability is ShareCapability {
  return (SHARE_CAPABILITIES as readonly string[]).includes(capability);
}

// Assert a capability is on the guardian allow-list; throw otherwise. Called at
// the top of every guardian-token write action — reaching a disallowed
// capability is a programming error, not user input, so throwing is correct.
export function assertGuardianCapability(
  capability: GuardianCapability,
): void {
  if (!guardianCan(capability)) {
    throw new Error(`Capability not permitted for guardian tokens: ${capability}`);
  }
}

// ---- Mint / hash / verify (pure) -------------------------------------------

// A ≥128-bit random token (32 bytes = 256-bit) as a URL-safe string, plus its
// sha256-hex hash. Only the hash is ever persisted.
export function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Constant-time compare of a raw token against a stored hash. Uses
// timingSafeEqual on the two hex hashes so verification time never leaks how
// much of a token matched.
export function verifyToken(raw: string, storedHash: string): boolean {
  const candidate = hashToken(raw);
  if (candidate.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidate, "utf8"),
      Buffer.from(storedHash, "utf8"),
    );
  } catch {
    return false;
  }
}

// ---- The three canonical footer links (email + staff display) --------------

// Base URL for tokenized links (used in emails, so it MUST resolve to a real
// host). Fallback chain:
//   1. APP_BASE_URL            — explicit override (full URL).
//   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel system env (host only, no scheme).
//   3. https://{brand.domain} — last resort; warns, because brand.domain defaults
//      to the placeholder "octv.example" which would email broken links.
// Constitution IX — no hardcoded product name (the brand domain flows from env).
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/\/+$/, "");
  if (vercelHost) return `https://${vercelHost}`;

  if (!process.env.BRAND_DOMAIN) {
    // No configured host anywhere — links will point at the placeholder domain.
    console.warn(
      "[tokens] appBaseUrl falling back to placeholder brand.domain " +
        `("${brand.domain}"). Set APP_BASE_URL (or deploy on Vercel) so ` +
        "tokenized parent links resolve to a real host.",
    );
  }
  return `https://${brand.domain}`;
}

// Every generated email footers the same three links so parents learn one
// pattern: everything is always in the latest email (§8a).
export interface GuardianLinks {
  itinerary: string;
  signup: string;
  absence: string;
}

export function guardianLinks(rawToken: string): GuardianLinks {
  const base = `${appBaseUrl()}/t/${rawToken}`;
  return {
    itinerary: `${base}/itinerary`,
    signup: `${base}/signup`,
    absence: `${base}/absence`,
  };
}

// ---- Resolution (service-role; the anonymous surface's entry point) ---------

export interface ResolvedProgram {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface ResolvedStudent {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
}

export interface ResolvedGuardianToken {
  kind: "guardian";
  tokenId: string;
  program: ResolvedProgram;
  guardian: {
    id: string;
    name: string;
    email: string | null;
    student_id: string;
  };
  // The family: every student whose guardians share this guardian's email in the
  // same program (a parent with two kids has two guardian rows). Falls back to
  // the single student when the email is null. This is the "own student(s)" set.
  students: ResolvedStudent[];
}

export interface ResolvedShareLink {
  kind: "share";
  tokenId: string;
  program: ResolvedProgram;
  resource: "itinerary" | "packet" | "signup_page";
  resource_id: string;
}

export type ResolvedToken = ResolvedGuardianToken | ResolvedShareLink | null;

// Resolve an opaque raw token to a family (guardian) or resource (share). Checks
// revoked_at / expires_at. Returns null for anything invalid, revoked, or
// expired — callers 404 cleanly on null so a bad link never reveals structure.
export async function resolveToken(raw: string): Promise<ResolvedToken> {
  if (!raw) return null;
  const hash = hashToken(raw);
  const supabase = createAdminClient();

  // Guardian token first (per-family, the common case).
  const { data: gt } = await supabase
    .from("guardian_tokens")
    .select("id, program_id, guardian_id, revoked_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (gt) {
    const row = gt as {
      id: string;
      program_id: string;
      guardian_id: string;
    };
    const program = await loadProgram(supabase, row.program_id);
    if (!program) return null;

    const { data: g } = await supabase
      .from("guardians")
      .select("id, name, email, student_id")
      .eq("id", row.guardian_id)
      .eq("program_id", row.program_id)
      .maybeSingle();
    if (!g) return null;
    const guardian = g as {
      id: string;
      name: string;
      email: string | null;
      student_id: string;
    };

    const students = await loadFamilyStudents(supabase, row.program_id, guardian);

    return {
      kind: "guardian",
      tokenId: row.id,
      program,
      guardian,
      students,
    };
  }

  // Share link (broadcast, read-only).
  const nowIso = new Date().toISOString();
  const { data: sl } = await supabase
    .from("share_links")
    .select("id, program_id, resource, resource_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (sl) {
    const link = sl as {
      id: string;
      program_id: string;
      resource: "itinerary" | "packet" | "signup_page";
      resource_id: string;
      expires_at: string | null;
    };
    if (link.expires_at && link.expires_at <= nowIso) return null;
    const program = await loadProgram(supabase, link.program_id);
    if (!program) return null;
    return {
      kind: "share",
      tokenId: link.id,
      program,
      resource: link.resource,
      resource_id: link.resource_id,
    };
  }

  return null;
}

async function loadProgram(
  supabase: SupabaseClient,
  programId: string,
): Promise<ResolvedProgram | null> {
  const { data } = await supabase
    .from("programs")
    .select("id, name, slug, timezone")
    .eq("id", programId)
    .maybeSingle();
  return (data as ResolvedProgram | null) ?? null;
}

// The family's students: all students whose guardians in this program share this
// guardian's (non-null) email — a parent with multiple kids has one guardian row
// per child. Email is the family key; still scoped to one program, so a leaked
// token exposes one family only.
async function loadFamilyStudents(
  supabase: SupabaseClient,
  programId: string,
  guardian: { id: string; email: string | null; student_id: string },
): Promise<ResolvedStudent[]> {
  let studentIds: string[] = [guardian.student_id];

  if (guardian.email) {
    const { data: siblings } = await supabase
      .from("guardians")
      .select("student_id")
      .eq("program_id", programId)
      .eq("email", guardian.email);
    const ids = ((siblings as { student_id: string }[] | null) ?? []).map(
      (s) => s.student_id,
    );
    if (ids.length > 0) studentIds = ids;
  }

  const unique = Array.from(new Set(studentIds));
  const { data: students } = await supabase
    .from("students")
    .select("id, first_name, last_name, status")
    .in("id", unique)
    .eq("program_id", programId)
    .order("last_name", { ascending: true });

  return (students as ResolvedStudent[] | null) ?? [];
}

// ---- Mint / revoke / rotate (staff + email pipeline) -----------------------

// Insert a fresh guardian token, returning the RAW token (shown/embedded once).
// Caller supplies the client: staff mint uses the RLS client (director/admin
// write policy); the email pipeline uses the service-role client.
export async function mintGuardianToken(
  supabase: SupabaseClient,
  args: { programId: string; guardianId: string },
): Promise<{ raw: string } | { error: string }> {
  const { raw, hash } = generateToken();
  const { error } = await supabase.from("guardian_tokens").insert({
    program_id: args.programId,
    guardian_id: args.guardianId,
    token_hash: hash,
  });
  if (error) return { error: error.message };
  return { raw };
}

// Revoke every active guardian token for a guardian (idempotent).
export async function revokeGuardianTokens(
  supabase: SupabaseClient,
  args: { programId: string; guardianId: string },
): Promise<void> {
  await supabase
    .from("guardian_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("program_id", args.programId)
    .eq("guardian_id", args.guardianId)
    .is("revoked_at", null);
}

// "Resend links": revoke the old token(s) and mint a new one. Returns the new
// RAW token. This is the model the design embraces — the newest communication
// always carries the live link ("everything is always in the latest email"),
// which is exactly why hash-only storage is acceptable: a prior raw is never
// needed again.
export async function rotateGuardianToken(
  supabase: SupabaseClient,
  args: { programId: string; guardianId: string },
): Promise<{ raw: string } | { error: string }> {
  await revokeGuardianTokens(supabase, args);
  return mintGuardianToken(supabase, args);
}

// For the email pipeline: return a usable RAW token to embed in this message.
// Because only the hash is stored, a prior token's raw can never be recovered —
// so to guarantee the email's links work we mint a fresh token here. This is
// APPEND-ONLY (it does NOT revoke prior tokens), so links from earlier emails
// keep working; explicit revocation is the staff "resend links" path
// (rotateGuardianToken). All of a family's tokens resolve to the same family, so
// multiple active tokens are safe — a leaked token still exposes one family
// only. Token rows are cheap; a pilot program accumulates a bounded handful per
// guardian per season.
export async function mintGuardianTokenForEmail(
  supabase: SupabaseClient,
  args: { programId: string; guardianId: string },
): Promise<{ raw: string } | { error: string }> {
  return mintGuardianToken(supabase, args);
}

// ---- Share links (broadcast, read-only; §8a / FR-002) ----------------------

// The public URL a share link resolves to — same /t/<token> shape as guardian
// links (parents learn one pattern). Known ONLY at mint time (hash-only storage),
// so callers surface it once and never reconstruct it later.
export function shareLinkUrl(rawToken: string): string {
  return `${appBaseUrl()}/t/${rawToken}`;
}

export type MintableShareResource = "itinerary" | "signup_page";

export interface ActiveShareLink {
  id: string;
  resource: "itinerary" | "packet" | "signup_page";
  resource_id: string;
  created_at: string;
  expires_at: string | null;
}

// Mint a broadcast share link, returning the RAW token (shown/embedded once).
// Staff mint uses the caller's RLS client (director/admin share_links write
// policy). Append-only — it never revokes prior links; use revokeShareLink to
// retire one. `expiresAt` is optional (null = no expiry).
export async function mintShareLink(
  supabase: SupabaseClient,
  args: {
    programId: string;
    resource: MintableShareResource;
    resourceId: string;
    expiresAt?: string | null;
  },
): Promise<{ raw: string } | { error: string }> {
  const { raw, hash } = generateToken();
  const { error } = await supabase.from("share_links").insert({
    program_id: args.programId,
    resource: args.resource,
    resource_id: args.resourceId,
    token_hash: hash,
    expires_at: args.expiresAt ?? null,
  });
  if (error) return { error: error.message };
  return { raw };
}

// Revoke one share link by id (idempotent; scoped to the program).
export async function revokeShareLink(
  supabase: SupabaseClient,
  args: { programId: string; shareLinkId: string },
): Promise<void> {
  await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", args.shareLinkId)
    .eq("program_id", args.programId)
    .is("revoked_at", null);
}

// Revoke every active share link for one resource (used to "rotate": retire the
// old broadcast link(s) for a competition/season before minting a fresh one).
export async function revokeShareLinksForResource(
  supabase: SupabaseClient,
  args: { programId: string; resource: MintableShareResource; resourceId: string },
): Promise<void> {
  await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("program_id", args.programId)
    .eq("resource", args.resource)
    .eq("resource_id", args.resourceId)
    .is("revoked_at", null);
}

// Active (non-revoked, non-expired) share links for a program — the Settings
// listing. Metadata only (resource / created / expires); the raw URL is never
// stored, so it cannot be re-shown here — staff rotate to get a fresh URL.
export async function activeShareLinks(
  supabase: SupabaseClient,
  programId: string,
): Promise<ActiveShareLink[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("share_links")
    .select("id, resource, resource_id, created_at, expires_at")
    .eq("program_id", programId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const rows = (data as ActiveShareLink[] | null) ?? [];
  return rows.filter((r) => !r.expires_at || r.expires_at > nowIso);
}

// ---- Token event logging (§10 security audit) ------------------------------

// Append a token_events row. Best-effort: logging never blocks or fails a token
// action (a failed audit insert must not deny a parent their itinerary).
export async function logTokenEvent(args: {
  programId: string;
  kind: TokenKind;
  tokenId: string;
  action: string;
  ip: string | null;
  supabase?: SupabaseClient;
}): Promise<void> {
  try {
    const supabase = args.supabase ?? createAdminClient();
    await supabase.from("token_events").insert({
      program_id: args.programId,
      token_kind: args.kind,
      token_id: args.tokenId,
      action: args.action,
      ip: args.ip,
    });
  } catch {
    // swallow — audit logging is best-effort, never a denial-of-service vector.
  }
}
