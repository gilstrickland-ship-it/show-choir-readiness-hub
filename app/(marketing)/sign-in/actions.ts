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
  if (error) {
    redirect(`/sign-in?error=link_failed&redirect=${encodeURIComponent(next)}`);
  }
  redirect(`/sign-in?sent=1&redirect=${encodeURIComponent(next)}`);
}
