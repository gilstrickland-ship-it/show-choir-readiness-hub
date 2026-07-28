// ============================================================================
// Unit tests — the rollover wizard adopts a season, but never a FROZEN one
// ----------------------------------------------------------------------------
// Step 1 of the wizard is deliberately re-runnable: a director who backs up and
// re-submits the same season name gets the same season back rather than a
// second one. That reuse looked at the label and nothing else — so a label that
// matched an ARCHIVED season silently adopted it.
//
// Archiving is the vault (§9.4): a frozen season, kept for the record, whose
// season-scoped writes RLS refuses. Adopting it pointed the whole wizard at
// last year's frozen books — ensembles, returning students, costume sets — and
// then, at the final step, un-froze it by making it the active season. Nothing
// on the screen ever named which season was being filled in.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const EXISTING = "22222222-2222-2222-2222-222222222222";

const h = vi.hoisted(() => ({
  // The same-label season this program already has, if any.
  existing: null as { id: string; archived_at: string | null } | null,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  // How many OTHER seasons the program has (decides the next wizard step).
  priorCount: 1,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireRole: async () => ({ user: { id: "u1" } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

vi.mock("@/lib/supabase/server", () => {
  const builderFor = (table: string) => {
    let op: "select" | "insert" = "select";
    let payload: Record<string, unknown> = {};
    let counting = false;

    const settle = (): unknown => {
      if (op === "insert") {
        h.inserts.push({ table, payload });
        return { data: { id: "brand-new-season" }, error: null };
      }
      if (counting) return { count: h.priorCount, error: null };
      // seasonByLabel: this program's season with that label, and whether it is
      // archived — which is the fact the old lookup never asked for.
      return { data: h.existing, error: null };
    };

    const builder = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        counting = Boolean(opts?.head);
        return builder;
      },
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return builder;
      },
      eq: () => builder,
      neq: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (onOk: (value: unknown) => unknown, onErr?: (r: unknown) => unknown) =>
        Promise.resolve(settle()).then(onOk, onErr),
    };
    return builder;
  };
  return {
    createClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

import { createRolloverSeason } from "@/app/(app)/[program]/settings/rollover/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await createRolloverSeason(form(fields));
  } catch (e) {
    return (e as Error & { url?: string }).url ?? "";
  }
  return "";
}

const base = { programId: PROGRAM, slug: "westfield", label: "2027-28" };

beforeEach(() => {
  h.existing = null;
  h.inserts = [];
  h.priorCount = 1;
});

describe("starting the rollover with a name that is already taken", () => {
  test("an ARCHIVED season with that label is refused, by name", async () => {
    h.existing = { id: EXISTING, archived_at: "2026-06-01T00:00:00Z" };
    const url = await run(base);
    expect(url).toContain("error=archived_label");
    // It scrolls to the wizard, which is where the name was typed.
    expect(url).toContain("#rollover");
    // And nothing was created under the frozen season's name.
    expect(h.inserts).toHaveLength(0);
    // Emphatically not "carry on into that season".
    expect(url).not.toContain("step=");
  });

  test("a LIVE season with that label is still reused — re-running step 1 is not an error", async () => {
    h.existing = { id: EXISTING, archived_at: null };
    const url = await run(base);
    expect(url).toContain(`newSeason=${EXISTING}`);
    expect(url).toContain("step=ensembles");
    expect(h.inserts).toHaveLength(0);
  });

  test("no season with that label → a new one, and on to the wizard", async () => {
    h.existing = null;
    const url = await run(base);
    expect(url).toContain("newSeason=brand-new-season");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].table).toBe("seasons");
    expect(h.inserts[0].payload.label).toBe("2027-28");
    // A season the wizard makes is never born active or archived.
    expect(h.inserts[0].payload.is_active).toBe(false);
  });

  test("a blank name is refused before any of that", async () => {
    const url = await run({ ...base, label: "  " });
    expect(url).toContain("error=label");
    expect(h.inserts).toHaveLength(0);
  });
});
