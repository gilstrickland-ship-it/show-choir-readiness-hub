"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { applyUnsubscribe } from "./unsubscribe-core";

// Guardian-token unsubscribe action (§8a, C1-4). Rate-limited (in applyUnsubscribe)
// like the absence action; sets guardians.email_status='unsubscribed' and logs a
// token event. Redirects back to the page with a status the page renders.

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return h.get("x-real-ip") ?? null;
}

export async function unsubscribe(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  const ip = await clientIp();
  const res = await applyUnsubscribe(token, ip);
  const s = res.ok ? "done" : res.reason;
  redirect(`/t/${token}/unsubscribe?s=${s}`);
}
