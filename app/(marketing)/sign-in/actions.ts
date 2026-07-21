"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Constitution II — accounts are for STAFF ONLY. These actions authenticate
// existing members; there is deliberately NO sign-up path. Parents and students
// never have accounts and are never invited to create one. New staff accounts
// come only from an invite created in Settings → Members.

function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") ? v : "/launch";
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

// Email + password sign-in.
export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("redirect"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(
      `/sign-in?error=invalid_credentials&redirect=${encodeURIComponent(next)}`,
    );
  }
  redirect(next);
}

// Magic-link (OTP) sign-in. shouldCreateUser:false enforces the staff-only rule
// at the auth layer — an email with no existing account gets no link.
export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNext(formData.get("redirect"));

  const supabase = await createClient();
  const emailRedirectTo = `${await origin()}/auth/callback?redirect=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo },
  });
  if (error && !isNoSuchUserError(error)) {
    // Genuine operational failure (network, rate-limit, misconfiguration).
    redirect(`/sign-in?error=link_failed&redirect=${encodeURIComponent(next)}`);
  }
  // Anti-enumeration: with shouldCreateUser:false, an address with no staff
  // account produces an AuthError ("Signups not allowed for otp") instead of a
  // send. Surfacing that as an error would let an attacker distinguish real
  // accounts from unknown ones. We deliberately fall through to the SAME neutral
  // ?sent=1 response as success — the copy ("If that address belongs to a staff
  // account, a sign-in link is on its way…") is already honest for both cases.
  redirect(`/sign-in?sent=1&redirect=${encodeURIComponent(next)}`);
}

// True when signInWithOtp failed specifically because the email has no existing
// account (shouldCreateUser:false + unknown address). GoTrue returns code
// "otp_disabled" / message "Signups not allowed for otp" / HTTP 422. Matched
// defensively on code AND message substring AND status so a minor server-side
// wording/code change can't silently reopen the enumeration channel.
function isNoSuchUserError(error: { code?: string; status?: number; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "otp_disabled" ||
    message.includes("signups not allowed") ||
    (error.status === 422 && message.includes("signup"))
  );
}
