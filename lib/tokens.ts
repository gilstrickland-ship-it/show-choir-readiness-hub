import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { brand } from "@/lib/brand";
import { flag, type FlagKey, type FlaggableProgram } from "@/lib/flags";

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
// claim/cancel own shift signups; submit an absence request for own student(s);
// unsubscribe this family's email address from announcements + digests.
// The one write that touches operations (absence) lands in a staff review queue.
// `email:unsubscribe` is a deliberate, justified addition (CAN-SPAM + one-click
// deliverability, RFC 8058): it is a *preference* write on the recipient's own
// address, NOT an operational write — so it is not in GUARDIAN_WRITE_CAPABILITIES
// below (which stays the three operational writes). The list stays tiny.
export const GUARDIAN_CAPABILITIES = [
  "costume:view",
  "itinerary:view",
  "signup:view",
  "shift:claim",
  "shift:cancel",
  "absence:submit",
  "email:unsubscribe",
] as const;

// Share links are read-only views of their one resource. Nothing else.
//
// "Their ONE resource" is literal, and it is the sharpest edge on this surface.
// A share link is a broadcast credential — a director pastes it into a booster
// Facebook post — so `resource:view` grants exactly the thing the link is named
// after and nothing derived from it. In particular an `itinerary` link opens the
// TIMES: the /itinerary page and that competition's .ics, and nothing else.
//
// It used to also open /packet. The parent packet PDF (lib/pdf/documents) prints
// bus and hotel-ROOM assignments listing students by name, plus chaperone and
// volunteer names — so one link the director was told shared "times" published a
// rooming list for minors to whoever read the post. The packet is now GUARDIAN
// TOKENS ONLY: a family that is already entitled to see its own child's room
// pulls it from their personal link, and no broadcast link reaches it at all
// (Constitution III — directory-tier only on anything anyone can open).
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
//      to the brand config's placeholder domain, which would email broken links.
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
  // Per-recipient unsubscribe page (CAN-SPAM footer link; §8a). Populated off the
  // same raw token so a leaked footer link still exposes one family only.
  unsubscribe: string;
}

export function guardianLinks(rawToken: string): GuardianLinks {
  const base = `${appBaseUrl()}/t/${rawToken}`;
  return {
    itinerary: `${base}/itinerary`,
    signup: `${base}/signup`,
    absence: `${base}/absence`,
    unsubscribe: `${base}/unsubscribe`,
  };
}

// The RFC 8058 one-click POST target for a raw token (a route handler, distinct
// from the human unsubscribe PAGE — Next.js can't host a page and a route at the
// same path). Used only as the List-Unsubscribe header URL.
export function unsubscribeOneClickUrl(rawToken: string): string {
  return `${appBaseUrl()}/t/${rawToken}/unsubscribe/one-click`;
}

// List-Unsubscribe + List-Unsubscribe-Post headers (RFC 8058 one-click). Every
// guardian-facing send passes these so mailbox providers show a native
// "Unsubscribe" affordance and can POST the one-click route directly.
export function listUnsubscribeHeaders(rawToken: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeOneClickUrl(rawToken)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ---- Resolution (service-role; the anonymous surface's entry point) ---------

// The program a token belongs to. It carries `tier` + `feature_overrides` (and
// so satisfies FlaggableProgram) because the anonymous surface has to evaluate
// the SAME feature flags the staff half does — see PARENT_SURFACE_FLAGS below.
// Both columns already exist on `programs`; this is one wider select, no schema.
export interface ResolvedProgram extends FlaggableProgram {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  tier: "prep" | "varsity" | "program";
  feature_overrides: Record<string, boolean> | null;
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

// Share-link resource kinds. `season_calendar` (Wave G / G1) resolves to a season
// and drives the subscribable /t/<token>/calendar feed; it is minted, listed, and
// revoked exactly like the others — no new capability, still `resource:view`.
//
// `packet` is an enum value 0001 shipped and NOTHING mints or accepts. That is
// deliberate, not an oversight: it would be a broadcast link to the document that
// names which hotel room each child sleeps in, and no amount of warning copy
// makes that a link worth handing a director a button for. It stays out of
// MintableShareResource (so no surface can mint one), no route accepts it, and
// the resolve-time guard below still refuses any row carrying it because
// nothing downstream will serve it. Removing the enum value would need a
// migration; leaving it unreachable costs nothing.
export type ShareResource =
  | "itinerary"
  | "packet"
  | "signup_page"
  | "season_calendar";

// What each kind of link is CALLED, in the words the app already uses for it
// (spec 005 Wave 13 / T164). Exhaustive over ShareResource, so adding a kind is
// a type error here rather than a raw enum value ("signup_page") reaching a
// director reading the Settings listing — which is what the page's own private
// copy of this map did for `packet` before it moved here.
export const SHARE_RESOURCE_LABELS: Record<ShareResource, string> = {
  itinerary: "Itinerary",
  packet: "Parent packet",
  signup_page: "Volunteer signup",
  season_calendar: "Season calendar",
};

export interface ResolvedShareLink {
  kind: "share";
  tokenId: string;
  program: ResolvedProgram;
  resource: ShareResource;
  resource_id: string;
}

export type ResolvedToken = ResolvedGuardianToken | ResolvedShareLink | null;

// ---- Cross-program resource guard (Constitution I) -------------------------
// share_links.resource_id is a POLYMORPHIC soft reference — it names a
// competition for one resource kind and a season for another, so no foreign key
// can express it and the database cannot stop a link minted in program A from
// pointing at program B's competition. That matters more here than anywhere
// else in the schema: the token surfaces are anonymous, so they run on the
// service-role client where RLS does not apply, and a link is the whole
// credential. Both ends are therefore closed in code — mintShareLink refuses to
// WRITE a link at another program's resource, and resolveToken refuses to
// RETURN one, so a row that predates this guard (or one written by any future
// path) is inert.

type ShareResourceTable = "competitions" | "seasons";

// The parent table each share resource points at. Exhaustive over
// ShareResource, so adding a resource kind is a type error here rather than a
// resource that quietly skips the program check.
const SHARE_RESOURCE_TABLES: Record<ShareResource, ShareResourceTable> = {
  itinerary: "competitions",
  packet: "competitions",
  signup_page: "seasons",
  season_calendar: "seasons",
};

// Undefined for anything not in the map — `resource` is read back from a
// Postgres enum, so callers must treat "no table" as "cannot verify".
export function shareResourceTable(
  resource: ShareResource,
): ShareResourceTable | undefined {
  return SHARE_RESOURCE_TABLES[resource];
}

// True only when resource_id names a row of that resource's parent table which
// lives in this program. Fails closed — a missing row, a blank id, or a query
// error all read as "not this program's".
async function shareResourceInProgram(
  supabase: SupabaseClient,
  args: { programId: string; resource: ShareResource; resourceId: string },
): Promise<boolean> {
  if (!args.programId || !args.resourceId) return false;
  // `resource` is a Postgres enum, so a value can appear in the database before
  // it appears in the map above (a migration adds it, the type lags). Unknown =
  // uncheckable = refused, never "allowed by default".
  const table = shareResourceTable(args.resource);
  if (!table) return false;

  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", args.resourceId)
    .eq("program_id", args.programId)
    .maybeSingle();
  return !error && Boolean(data);
}

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
      resource: ShareResource;
      resource_id: string;
      expires_at: string | null;
    };
    if (link.expires_at && link.expires_at <= nowIso) return null;

    // The resource must live in the link's OWN program. Every downstream surface
    // derives its scope from what we return here, and one of them (the parent
    // packet) keys off resource_id alone — so this check is what keeps a link
    // from reaching across tenants. 404 (null) on a mismatch, like any other
    // unusable link.
    const ownsResource = await shareResourceInProgram(supabase, {
      programId: link.program_id,
      resource: link.resource,
      resourceId: link.resource_id,
    });
    if (!ownsResource) return null;

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
    // tier + feature_overrides ride along so every parent route can evaluate the
    // owning program's flags without a second query (see PARENT_SURFACE_FLAGS).
    .select("id, name, slug, timezone, tier, feature_overrides")
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
//
// The guardian is resolved INSIDE the program first. guardian_id carries only a
// single-column foreign key, and the write policy checks only the row's own
// program_id, so without this a token row could name another program's guardian:
// unreadable to that program, yet enough to block them from ever deleting the
// family. Doing it here covers every mint path — staff rotate, the email
// pipeline, and anything added later — instead of once per caller.
export async function mintGuardianToken(
  supabase: SupabaseClient,
  args: { programId: string; guardianId: string },
): Promise<{ raw: string } | { error: string }> {
  const { data: guardian } = await supabase
    .from("guardians")
    .select("id")
    .eq("id", args.guardianId)
    .eq("program_id", args.programId)
    .maybeSingle();
  if (!guardian) return { error: "That family is not in this program." };

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

// The subscribable season-calendar feed URL for a raw token (Wave G / G1). The
// feed lives at /t/<token>/calendar (Next.js hosts the /t/<token> pages and this
// route at distinct paths). Known ONLY at mint time (hash-only storage) — shown
// once, never reconstructed. Calendar apps ("From URL" in Google Calendar) accept
// the https form; a webcal:// scheme is the same URL with the scheme swapped.
export function seasonCalendarUrl(rawToken: string): string {
  return `${appBaseUrl()}/t/${rawToken}/calendar`;
}

export type MintableShareResource =
  | "itinerary"
  | "signup_page"
  | "season_calendar";

export interface ActiveShareLink {
  id: string;
  resource: ShareResource;
  resource_id: string;
  created_at: string;
  expires_at: string | null;
}

// Mint a broadcast share link, returning the RAW token (shown/embedded once).
// Staff mint uses the caller's RLS client (director/admin share_links write
// policy). Append-only — it never revokes prior links; use revokeShareLink to
// retire one. `expiresAt` is optional (null = no expiry).
//
// resourceId arrives from a form, so it is resolved inside the program before
// anything is written (see the cross-program guard above). Every mint path —
// itinerary publish/rotate, signup page, season calendar — goes through here, so
// one check covers them all, and callers already handle the {error} return.
export async function mintShareLink(
  supabase: SupabaseClient,
  args: {
    programId: string;
    resource: MintableShareResource;
    resourceId: string;
    expiresAt?: string | null;
  },
): Promise<{ raw: string } | { error: string }> {
  const owned = await shareResourceInProgram(supabase, {
    programId: args.programId,
    resource: args.resource,
    resourceId: args.resourceId,
  });
  if (!owned) return { error: "That resource is not part of this program." };

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
//
// RETURNS WHETHER THE URL IS ACTUALLY DEAD. This used to be `Promise<void>`, and
// the caller told the director "That URL stops working immediately" whatever
// happened — including when the write was refused, or when the id belonged to
// another program and matched nothing. Revocation is the one control a director
// has over a link they have already handed out; being told a live URL is dead is
// worse than being told nothing.
//
// Zero rows is not automatically a failure, though: the update is filtered on
// `revoked_at is null`, so a second press of a button on a stale page matches
// nothing while the link IS dead. That case is confirmed with one read rather
// than guessed at in either direction.
export async function revokeShareLink(
  supabase: SupabaseClient,
  args: { programId: string; shareLinkId: string },
): Promise<{ ok: boolean }> {
  const { data, error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", args.shareLinkId)
    .eq("program_id", args.programId)
    .is("revoked_at", null)
    .select("id");
  if (error) return { ok: false };
  if (((data as { id: string }[] | null) ?? []).length > 0) return { ok: true };

  // Nothing matched. Either it was already revoked — the URL is dead, which is
  // what the message claims — or it is not this program's link at all, and
  // nothing was revoked by anyone.
  const { data: already } = await supabase
    .from("share_links")
    .select("id")
    .eq("id", args.shareLinkId)
    .eq("program_id", args.programId)
    .not("revoked_at", "is", null)
    .maybeSingle();
  return { ok: Boolean(already) };
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
//
// `unavailable` is the read having FAILED, and it is a separate answer from an
// empty list on purpose: an empty list renders as "Nothing is shared right now.
// Anyone outside your staff sees nothing until you make a link", which is a
// statement about what this program has handed out — and it is exactly wrong
// when what actually happened is that we could not look.
export interface ActiveShareLinksResult {
  links: ActiveShareLink[];
  unavailable: boolean;
}

export async function activeShareLinks(
  supabase: SupabaseClient,
  programId: string,
): Promise<ActiveShareLinksResult> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("share_links")
    .select("id, resource, resource_id, created_at, expires_at")
    .eq("program_id", programId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return { links: [], unavailable: true };
  const rows = (data as ActiveShareLink[] | null) ?? [];
  return {
    links: rows.filter((r) => !r.expires_at || r.expires_at > nowIso),
    unavailable: false,
  };
}

// ---- Which token kinds may open which document (Constitution III) ----------
//
// The table this file did not have, and whose absence was the bug: publishing an
// itinerary auto-mints a BROADCAST link, the director is told they shared the
// times, and the same URL also served the parent packet PDF — a document that
// prints bus and hotel-ROOM assignments student by student, plus chaperone and
// volunteer names. Every route decided its own answer in its own `if`, so the
// two documents behind one link drifted apart without anyone deciding they
// should.
//
// It is stated once here, exhaustively, and the routes ask it rather than
// deciding. A document that lists people by name is guardian-only; a document
// that lists TIMES may ride a broadcast link.
export type ParentDocument =
  | "itinerary_page"
  | "itinerary_ics"
  | "packet_pdf"
  | "season_feed";

export const DOCUMENT_TOKEN_KINDS: Record<ParentDocument, readonly TokenKind[]> = {
  // The published schedule. Times, titles, locations — no person is named.
  itinerary_page: ["guardian", "share"],
  // The same schedule as a calendar file. Same content, so the same answer.
  itinerary_ics: ["guardian", "share"],
  // The parent packet. NAMES STUDENTS AGAINST ROOMS. A family may pull their
  // own; a link made to be posted publicly may not pull anyone's.
  packet_pdf: ["guardian"],
  // The season calendar feed is addressed by a season, which a per-family token
  // never names.
  season_feed: ["share"],
};

export function documentAllowsToken(
  document: ParentDocument,
  kind: TokenKind,
): boolean {
  return DOCUMENT_TOKEN_KINDS[document].includes(kind);
}

// ---- Feature flags on the anonymous surface (Constitution VIII) -------------
//
// THE RULE, written down once, because it was written down nowhere and so was
// evaluated nowhere: no route under /t/<token> checked a flag at all. Turning
// `shifts` off hid the staff half and left families still claiming volunteer
// slots nobody could see or manage — a feature that is "off" must be genuinely
// unreachable, not merely unlinked.
//
//   1. A parent surface is available only when EVERY flag its STAFF half
//      requires is on for the token's own program — the same keys, in the same
//      combinations. That is what keeps the two halves from disagreeing:
//      /comms/shifts gates on comms AND shifts, so parent signup does too.
//   2. A token that does not resolve answers exactly as it always did — 404 /
//      "link no longer active". Nothing here changes what an unknown token
//      learns.
//   3. A VALID family token pointed at a flag-off surface gets a calm "this
//      isn't available" page, not a hard 404. A parent holding a link that works
//      everywhere else deserves a sentence rather than a dead end, and the
//      sentence names no feature — so it discloses nothing about what this or
//      any other program has turned on. The file routes (packet PDF, .ics,
//      calendar feed) have no page to render, so they say the same sentence as
//      a plain-text 404 body.
//   4. Actions RE-CHECK. A page that hides a form is not a gate: every write on
//      this surface resolves the token itself, so it re-evaluates the flag
//      itself.
//   5. Unsubscribe is DELIBERATELY UNGATED, and is the only entry with no flags.
//      CAN-SPAM and RFC 8058 make "stop emailing me" unconditional; a program
//      that turned `comms` off after sending mail must still honour the footer
//      link in the mail it already sent.
//
// The map is exhaustive over the surfaces and asserted in tests/unit/tokens —
// adding a parent route means adding a line here, which is the point.
export type ParentSurface =
  | "itinerary"
  | "packet"
  | "signup"
  | "absence"
  | "costumes"
  | "welcome"
  | "unsubscribe";

export const PARENT_SURFACE_FLAGS: Record<ParentSurface, readonly FlagKey[]> = {
  // /t/<token>/itinerary + the per-competition .ics — staff half is
  // /competitions/<id>/itinerary (requireFlag 'competitions').
  itinerary: ["competitions"],
  // /t/<token>/packet — the same competition document, same flag.
  packet: ["competitions"],
  // /t/<token>/signup + claim/cancel — staff half is /comms/shifts, which gates
  // on BOTH (lib/readiness, lib/nav and the season page all say so).
  signup: ["comms", "shifts"],
  // /t/<token>/absence — staff half is /competitions/absences ('competitions').
  absence: ["competitions"],
  // The per-student costume cards on the family home; staff half is /costumes.
  costumes: ["costumes"],
  // The first-visit welcome card. flagRegistry's `guide` description names the
  // "parent welcome card" in as many words, and nothing evaluated it.
  welcome: ["guide"],
  // Unconditional — see rule 5.
  unsubscribe: [],
};

// The season-calendar feed is the one ANY-OF surface, because the season page
// that mints it is: it 404s only when competitions, events AND travel are all
// off. The feed mirrors that, and each section inside it is filtered by its own
// flag, so a program with events off never has an event in its feed.
export const SEASON_CALENDAR_FLAGS: readonly FlagKey[] = [
  "competitions",
  "events",
  "travel",
];

export function parentSurfaceAvailable(
  program: FlaggableProgram,
  surface: ParentSurface,
): boolean {
  return PARENT_SURFACE_FLAGS[surface].every((key) => flag(program, key));
}

export function seasonCalendarAvailable(program: FlaggableProgram): boolean {
  return SEASON_CALENDAR_FLAGS.some((key) => flag(program, key));
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
