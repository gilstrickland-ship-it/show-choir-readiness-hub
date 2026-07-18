import { notFound } from "next/navigation";
import { getResolvedToken } from "@/lib/public-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTimeInTz } from "@/lib/datetime";
import { TokenFooter } from "../parts";
import { claimShift, cancelShift } from "./actions";

// Tokenized volunteer signup (§8a). Guardian token: claim / cancel own signups,
// capacity-aware. Share link (or any browse view): read-only list of open shifts
// with an "ask for your family link" note — no claim controls.

const STATUS_MESSAGE: Record<string, { text: string; ok: boolean }> = {
  claimed: { text: "You're signed up. Thank you!", ok: true },
  cancelled: { text: "Your signup was cancelled.", ok: true },
  already: { text: "You're already signed up for that shift.", ok: true },
  full: { text: "That shift just filled up. Try another below.", ok: false },
  invalid: { text: "That link or shift is no longer valid.", ok: false },
  ratelimited: { text: "Too many requests — please wait a moment.", ok: false },
};

interface ShiftRow {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  needed_count: number;
  notes: string | null;
}

export default async function PublicSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { token } = await params;
  const { s } = await searchParams;
  const resolved = await getResolvedToken(token);
  if (!resolved) notFound();

  const { program } = resolved;
  const tz = program.timezone;
  const isGuardian = resolved.kind === "guardian";
  const supabase = createAdminClient();

  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("program_id", program.id)
    .eq("is_active", true)
    .maybeSingle();
  const seasonId = (season as { id: string } | null)?.id ?? null;

  const nowIso = new Date().toISOString();
  let shifts: ShiftRow[] = [];
  if (seasonId) {
    const { data } = await supabase
      .from("shifts")
      .select("id, title, starts_at, ends_at, needed_count, notes")
      .eq("program_id", program.id)
      .eq("season_id", seasonId)
      .or(`starts_at.is.null,starts_at.gte.${nowIso}`)
      .order("starts_at", { ascending: true, nullsFirst: false });
    shifts = (data as ShiftRow[] | null) ?? [];
  }

  const shiftIds = shifts.map((sh) => sh.id);

  // Confirmed counts per shift + this guardian's own confirmed shifts.
  const confirmedCount = new Map<string, number>();
  const mySignups = new Set<string>();
  if (shiftIds.length > 0) {
    const { data: signups } = await supabase
      .from("shift_signups")
      .select("shift_id, guardian_id, status")
      .eq("program_id", program.id)
      .in("shift_id", shiftIds)
      .eq("status", "confirmed");
    for (const su of (signups as { shift_id: string; guardian_id: string | null }[] | null) ?? []) {
      confirmedCount.set(su.shift_id, (confirmedCount.get(su.shift_id) ?? 0) + 1);
      if (isGuardian && su.guardian_id === resolved.guardian.id) {
        mySignups.add(su.shift_id);
      }
    }
  }

  const message = s ? STATUS_MESSAGE[s] : undefined;

  return (
    <section className="stack">
      <h1>Volunteer signup</h1>

      {message && (
        <p className={message.ok ? "alert-ok" : "alert-error"}>{message.text}</p>
      )}

      {!isGuardian && (
        <p className="muted">
          This is a shared browse link. To sign up, ask your director for your
          family&apos;s personal link.
        </p>
      )}

      {shifts.length === 0 && <p className="muted">No open shifts right now.</p>}

      {shifts.map((shift) => {
        const filled = confirmedCount.get(shift.id) ?? 0;
        const open = Math.max(0, shift.needed_count - filled);
        const mine = mySignups.has(shift.id);
        return (
          <div key={shift.id} className="confirm-box" style={{ width: "100%" }}>
            <strong>{shift.title}</strong>
            {shift.starts_at && (
              <div className="muted">{formatDateTimeInTz(shift.starts_at, tz)}</div>
            )}
            {shift.notes && <div className="muted">{shift.notes}</div>}
            <div style={{ marginTop: "0.4rem" }}>
              {open > 0 ? (
                <span>
                  {open} of {shift.needed_count} spot{shift.needed_count === 1 ? "" : "s"} open
                </span>
              ) : (
                <span className="muted">Full ({shift.needed_count} filled)</span>
              )}
            </div>

            {isGuardian && (
              <div style={{ marginTop: "0.5rem" }}>
                {mine ? (
                  <form action={cancelShift}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <span className="badge" style={{ marginRight: "0.5rem" }}>
                      You&apos;re signed up
                    </span>
                    <button type="submit" className="secondary">
                      Cancel my signup
                    </button>
                  </form>
                ) : open > 0 ? (
                  <form action={claimShift}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <button type="submit">Sign up</button>
                  </form>
                ) : (
                  <span className="muted">This shift is full.</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      <TokenFooter token={token} kind={resolved.kind} />
    </section>
  );
}
