import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembership, type Membership, type Role } from "@/lib/auth";
import { flag, flagRegistry, type FlagKey, type FlaggableProgram } from "@/lib/flags";
import { supportAccessActive, logSupportView } from "@/lib/support";

// The tenant shell's single resolution point. Server components (layout + pages)
// call getTenantContext(slug); React cache() dedupes it within a request so the
// membership lookup and flag evaluation run once even though layout and page
// both call it. This is the "helper + cache()" pattern the task prescribes over
// client context — everything here is a server component.

export interface TenantProgram extends FlaggableProgram {
  id: string;
  name: string;
  slug: string;
  school_name: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  tier: "prep" | "varsity" | "program";
  feature_overrides: Record<string, boolean> | null;
  weekly_note: string | null;
  size_fields: string[];
  support_access_until: string | null;
}

export interface TenantSeason {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  archived_at: string | null;
}

export interface TenantContext {
  program: TenantProgram;
  membership: Membership;
  role: Role;
  season: TenantSeason | null;
  flags: Record<FlagKey, boolean>;
  // True when the caller is an Octv support user viewing under active consent
  // (no program_members row of their own). Read-only everywhere: the synthetic
  // role is board_member (the read-only seat), server actions re-check
  // membership (which support lacks) so no write can succeed, and the tenant
  // shell shows a persistent banner. See §10 / lib/support.ts.
  isSupport: boolean;
}

// Resolve program by slug + caller's active membership + active season, and
// evaluate every flag once. Not signed in → /sign-in (with return path). Signed
// in but no membership, or unknown slug → 404 (never reveal a program exists to
// a non-member).
export const getTenantContext = cache(
  async (programSlug: string): Promise<TenantContext> => {
    const user = await getSessionUser();
    if (!user) {
      redirect(`/sign-in?redirect=${encodeURIComponent(`/${programSlug}/dashboard`)}`);
    }

    const supabase = await createClient();

    const { data: program } = await supabase
      .from("programs")
      .select(
        "id, name, slug, school_name, city, state, timezone, tier, feature_overrides, weekly_note, size_fields, support_access_until",
      )
      .eq("slug", programSlug)
      .maybeSingle();

    if (!program) {
      notFound();
    }
    const typedProgram = program as TenantProgram;

    // Normal path: the caller is an active member; their role drives everything.
    // Support path: no membership, but an Octv support user (profiles.is_support)
    // viewing under active director consent gets a READ-ONLY view mapped to the
    // board_member seat. Anything else → 404 (never reveal the program exists).
    let membership = await getMembership(typedProgram.id, user.id);
    let isSupport = false;
    if (!membership) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_support")
        .eq("id", user.id)
        .maybeSingle();
      const supportEligible =
        (profile as { is_support: boolean } | null)?.is_support === true &&
        supportAccessActive(typedProgram.support_access_until);
      if (!supportEligible) {
        notFound();
      }
      isSupport = true;
      logSupportView({
        programSlug,
        programId: typedProgram.id,
        userId: user.id,
      });
      // Synthetic, read-only membership. It never reaches the DB — server-action
      // guards call getMembership() (which returns null for support), so writes
      // are impossible; RLS blocks them too (Constitution I, defense in depth).
      membership = {
        id: "support",
        program_id: typedProgram.id,
        user_id: user.id,
        role: "board_member",
        status: "active",
        invited_email: null,
      };
    }

    const { data: season } = await supabase
      .from("seasons")
      .select("id, label, starts_on, ends_on, is_active, archived_at")
      .eq("program_id", typedProgram.id)
      .eq("is_active", true)
      .maybeSingle();

    const flags = Object.fromEntries(
      (Object.keys(flagRegistry) as FlagKey[]).map((key) => [
        key,
        flag(typedProgram, key),
      ]),
    ) as Record<FlagKey, boolean>;

    return {
      program: typedProgram,
      membership,
      role: membership.role,
      season: (season as TenantSeason | null) ?? null,
      flags,
      isSupport,
    };
  },
);
