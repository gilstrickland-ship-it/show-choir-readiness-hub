// ============================================================================
// Unit tests — Settings & entry (spec 005 Wave 13, T164/T165)
// ----------------------------------------------------------------------------
// Three things this wave has to be able to prove, none of which a screenshot can:
//
// 1. THE LAST-DIRECTOR GUARD. A program must never end up with nobody who can
//    run it. Both member writes refuse when the target is the only active
//    director — re-roling them away from director, and removing them outright —
//    and the refusal has to reach the row that tried, not a banner at the top of
//    a list the director then has to scan.
// 2. FAIL-CLOSED REDIRECTS. `slug` arrives as a form field. A form posting
//    slug="/evil.com" must not produce "//evil.com/settings", which every
//    browser reads as a different ORIGIN and follows off-site (T143a).
// 3. THE MESSAGE MAPS. A code rides in the URL, so an unknown one — including a
//    prototype key like `constructor`, and a duplicated param that arrives as an
//    ARRAY — must resolve to no message rather than to something React is asked
//    to render. /launch had exactly that hole before this wave.
//
// No DB and no network: the module boundary is replaced with recorders.
// ============================================================================

import { describe, test, expect, beforeEach, vi } from "vitest";
import { readFlash } from "@/lib/flash";

const PROGRAM = "11111111-1111-1111-1111-111111111111";
const DIRECTOR = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";
const SEASON = "44444444-4444-4444-4444-444444444444";

const h = vi.hoisted(() => ({
  // The member row each lookup answers with, keyed by program_members.id.
  members: {} as Record<string, { role: string; status: string }>,
  // How many ACTIVE directors the program has right now.
  directorCount: 2,
  // WHO IS ASKING. Both member writes are open to director/admin, and the seat
  // the caller holds is what decides whether they may hand out `director`.
  callerRole: "director" as string,
  // Whether the share-link revoke actually killed the URL.
  revokeOk: true,
  // The season rows this program has, keyed by seasons.id. A season id NOT in
  // here is another program's — which the archive guard has to resolve away
  // before it writes anything.
  seasons: {} as Record<string, { is_active: boolean }>,
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("@/lib/auth", () => ({
  requireRole: async () => ({
    user: { id: "u1" },
    membership: { id: "m1", role: h.callerRole, status: "active" },
  }),
  ROLE_LABELS: {},
}));
// revokeShareLink now REPORTS whether the URL is actually dead, and the action's
// message ("That URL stops working immediately") is only said when it is. The
// mock answers with whatever the test set.
vi.mock("@/lib/tokens", () => ({
  revokeShareLink: async () => ({ ok: h.revokeOk }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { url?: string };
    err.url = url;
    throw err;
  },
}));

vi.mock("@/lib/supabase/server", () => {
  const builderFor = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "insert" = "select";
    let payload: Record<string, unknown> = {};
    let counting = false;

    const settle = (): unknown => {
      if (op === "insert") {
        h.inserts.push({ table, payload });
        return { data: { id: "new-member" }, error: null };
      }
      if (op === "update") {
        h.updates.push({ table, payload });
        return { data: null, error: null };
      }
      // The head/count query is activeDirectorCount asking how many are left.
      if (counting) return { count: h.directorCount, error: null };
      const id = String(filters.id ?? "");
      if (table === "seasons") {
        const season = h.seasons[id];
        // Program-scoped, like the real query: the fixture holds only this
        // program's seasons, so anything else resolves to nothing.
        return {
          data: season ? { id, is_active: season.is_active } : null,
          error: null,
        };
      }
      const row = h.members[id];
      return { data: row ?? null, error: null };
    };

    const builder = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        counting = Boolean(opts?.head);
        return builder;
      },
      update: (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return builder;
      },
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return builder;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      },
      is: () => builder,
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

import {
  reRoleMember,
  removeMember,
  inviteMember,
  updateProgram,
  grantSupportAccess,
  revokeShareLinkAction,
  archiveSeason,
} from "@/app/(app)/[program]/settings/actions";
import { SETTINGS_FLASH_MAPS, MEMBER_FLASH_MAPS } from "@/app/(app)/[program]/settings/shared";
import { ROLLOVER_FLASH_MAPS } from "@/app/(app)/[program]/settings/rollover/shared";
import { LAUNCH_FLASH_MAPS } from "@/app/launch/shared";
import { INVITE_FLASH_MAPS } from "@/app/invite/[inviteId]/shared";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run(
  action: (fd: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<string> {
  try {
    await action(form(fields));
  } catch (e) {
    return (e as Error & { url?: string }).url ?? "";
  }
  return "";
}

beforeEach(() => {
  h.updates = [];
  h.inserts = [];
  h.directorCount = 2;
  h.callerRole = "director";
  h.revokeOk = true;
  h.seasons = {};
  h.members = {
    [DIRECTOR]: { role: "director", status: "active" },
    [ADMIN]: { role: "admin", status: "active" },
  };
});

// ---------------------------------------------------------------------------
// Only a director hands out the director seat. `director` is the seat every
// DIRECTOR_ONLY control answers to — support consent, unarchiving a season — so
// an admin able to grant it has defeated all of them at once, and the shortest
// route there is naming their OWN memberId.
describe("granting the director seat", () => {
  test("an admin cannot promote someone else to director", async () => {
    h.callerRole = "admin";
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
      role: "director",
    });
    expect(url).toContain("error=director_only");
    expect(h.updates).toHaveLength(0);
  });

  test("an admin cannot promote THEMSELVES — the same check, no self-case", async () => {
    h.callerRole = "admin";
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      // Their own row: the hole was that nothing looked at who was asking.
      memberId: ADMIN,
      role: "director",
    });
    expect(url).toContain("error=director_only");
    expect(h.updates).toHaveLength(0);
  });

  test("the refusal reopens the row that tried", async () => {
    h.callerRole = "admin";
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: ADMIN,
      role: "director",
    });
    expect(url).toContain(`edit=${ADMIN}`);
    expect(url).toContain(`#member-${ADMIN}`);
  });

  test("a director can", async () => {
    h.callerRole = "director";
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: ADMIN,
      role: "director",
    });
    expect(url).toBe("/westfield/settings/members?ok=saved");
    expect(h.updates).toEqual([
      { table: "program_members", payload: { role: "director" } },
    ]);
  });

  test("an admin's other role changes are untouched", async () => {
    h.callerRole = "admin";
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: ADMIN,
      role: "treasurer",
    });
    expect(url).toBe("/westfield/settings/members?ok=saved");
    expect(h.updates).toEqual([
      { table: "program_members", payload: { role: "treasurer" } },
    ]);
  });

  test("and the invite door is shut the same way", async () => {
    h.callerRole = "admin";
    const url = await run(inviteMember, {
      programId: PROGRAM,
      slug: "westfield",
      email: "me+2@example.com",
      role: "director",
    });
    expect(url).toContain("error=invite_director_only");
    expect(h.inserts).toHaveLength(0);
  });

  test("a director may still invite a director", async () => {
    h.callerRole = "director";
    const url = await run(inviteMember, {
      programId: PROGRAM,
      slug: "westfield",
      email: "new@example.com",
      role: "director",
    });
    expect(url).toContain("invited=");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].payload.role).toBe("director");
  });
});

// ---------------------------------------------------------------------------
describe("the last-director guard", () => {
  test("re-roling the only director away from director is refused", async () => {
    h.directorCount = 1;
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
      role: "admin",
    });
    expect(url).toContain("error=last_director");
    expect(h.updates).toHaveLength(0);
  });

  test("removing the only director is refused", async () => {
    h.directorCount = 1;
    const url = await run(removeMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
    });
    expect(url).toContain("error=last_director");
    expect(h.updates).toHaveLength(0);
  });

  test("the refusal comes back to the row that tried, not to the page", async () => {
    h.directorCount = 1;
    const url = await run(removeMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
    });
    // `?edit=` reopens that member's panel and the anchor scrolls to it, so the
    // message lands inside the control that produced it.
    expect(url).toContain(`edit=${DIRECTOR}`);
    expect(url).toContain(`#member-${DIRECTOR}`);
  });

  test("with a second director the same write goes through", async () => {
    h.directorCount = 2;
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
      role: "admin",
    });
    expect(url).toBe("/westfield/settings/members?ok=saved");
    expect(h.updates).toEqual([
      { table: "program_members", payload: { role: "admin" } },
    ]);
  });

  test("the guard is about DIRECTORS, not about being the last member", async () => {
    h.directorCount = 1;
    const url = await run(removeMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: ADMIN,
    });
    expect(url).toBe("/westfield/settings/members?ok=removed");
    expect(h.updates).toEqual([
      { table: "program_members", payload: { status: "removed" } },
    ]);
  });

  test("a director who is only INVITED is not one of the ones being counted", async () => {
    // They cannot run the program yet, so demoting them cannot strand it.
    h.directorCount = 1;
    h.members[DIRECTOR] = { role: "director", status: "invited" };
    const url = await run(reRoleMember, {
      programId: PROGRAM,
      slug: "westfield",
      memberId: DIRECTOR,
      role: "board_member",
    });
    expect(url).not.toContain("last_director");
  });
});

// ---------------------------------------------------------------------------
describe("no redirect is built out of what a form posted (T143a)", () => {
  const hostile = { programId: PROGRAM, slug: "/evil.com" };

  test("a refused rename fails closed to /", async () => {
    const url = await run(updateProgram, { ...hostile, name: "", timezone: "" });
    expect(url.startsWith("//")).toBe(false);
    expect(url).toBe("/?error=missing#program");
  });

  test("a member refusal fails closed too", async () => {
    h.directorCount = 1;
    const url = await run(removeMember, { ...hostile, memberId: DIRECTOR });
    expect(url.startsWith("//")).toBe(false);
    expect(url.startsWith("/?")).toBe(true);
  });

  test("a success does the same", async () => {
    const url = await run(grantSupportAccess, hostile);
    expect(url.startsWith("//")).toBe(false);
    expect(url).toBe("/?ok=granted#support-access");
  });
});

// ---------------------------------------------------------------------------
describe("every outcome lands in the section that produced it", () => {
  test("the program form's messages anchor to Program", async () => {
    expect(
      await run(updateProgram, { programId: PROGRAM, slug: "d", name: "", timezone: "" }),
    ).toBe("/d/settings?error=missing#program");
  });

  test("support consent anchors to Support access", async () => {
    expect(await run(grantSupportAccess, { programId: PROGRAM, slug: "d" })).toBe(
      "/d/settings?ok=granted#support-access",
    );
  });

  test("revoking a link anchors to Share links", async () => {
    expect(
      await run(revokeShareLinkAction, {
        programId: PROGRAM,
        slug: "d",
        shareLinkId: "abc",
      }),
    ).toBe("/d/settings?ok=revoked#share-links");
  });
});

// ---------------------------------------------------------------------------
// Revocation is the ONE control a director has over a URL they have already
// handed out, and the message it prints — "That URL stops working immediately"
// — used to be unconditional: lib/tokens' revokeShareLink was `Promise<void>`
// and threw its result away, so a refused write, or a link id belonging to
// another program, read as a successful revoke. Being told a live link is dead
// is worse than being told nothing.
describe("revoking a share link says only what happened", () => {
  test("the URL really is dead → the confident message", async () => {
    h.revokeOk = true;
    expect(
      await run(revokeShareLinkAction, {
        programId: PROGRAM,
        slug: "d",
        shareLinkId: "abc",
      }),
    ).toBe("/d/settings?ok=revoked#share-links");
  });

  test("nothing was revoked → a refusal, in the same section", async () => {
    h.revokeOk = false;
    const url = await run(revokeShareLinkAction, {
      programId: PROGRAM,
      slug: "d",
      shareLinkId: "abc",
    });
    expect(url).toBe("/d/settings?error=revoke#share-links");
    // And emphatically NOT the reassurance.
    expect(url).not.toContain("ok=revoked");
  });
});

// ---------------------------------------------------------------------------
// Archiving is the vault door (§9.4): it freezes every season-scoped write.
// Doing it to the ACTIVE season freezes the one season every page reads, with
// nothing to fall back to and no way out except unarchiving — which only a
// director may do. The Seasons table renders no Archive button on the active
// row, and the header comment claimed the action was guarded; it was not, and a
// hidden control is not a guard (Constitution I) — this is a form POST with a
// season id in it.
describe("archiving the active season", () => {
  test("is refused, and nothing is written", async () => {
    h.seasons = { [SEASON]: { is_active: true } };
    const url = await run(archiveSeason, {
      programId: PROGRAM,
      slug: "d",
      seasonId: SEASON,
    });
    expect(url).toBe("/d/settings/rollover?error=archive_active#all-seasons");
    expect(h.updates).toHaveLength(0);
  });

  test("an inactive season still archives", async () => {
    h.seasons = { [SEASON]: { is_active: false } };
    const url = await run(archiveSeason, {
      programId: PROGRAM,
      slug: "d",
      seasonId: SEASON,
    });
    expect(url).toBe("/d/settings/rollover?ok=archived#all-seasons");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe("seasons");
    expect(h.updates[0].payload.archived_at).toBeTypeOf("string");
  });

  test("a season id that is not this program's is refused, not written", async () => {
    h.seasons = {};
    const url = await run(archiveSeason, {
      programId: PROGRAM,
      slug: "d",
      seasonId: "someone-elses-season",
    });
    expect(url).toBe("/d/settings/rollover?error=archive#all-seasons");
    expect(h.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("a code that rides in the URL cannot reach the prototype", () => {
  // /launch read its messages as `ERRORS[error]` off a bare object, so
  // `?error=constructor` resolved to Object.prototype.constructor — a FUNCTION,
  // which the page's truthiness check waved straight through to React.
  const maps = [
    ["settings", SETTINGS_FLASH_MAPS],
    ["members", MEMBER_FLASH_MAPS],
    ["seasons", ROLLOVER_FLASH_MAPS],
    ["launch", LAUNCH_FLASH_MAPS],
    ["invite", INVITE_FLASH_MAPS],
  ] as const;

  const PROTOTYPE_KEYS = ["constructor", "toString", "__proto__", "valueOf"];

  test.each(maps)("%s never resolves one to something renderable", (_name, map) => {
    for (const key of PROTOTYPE_KEYS) {
      const entry = readFlash({ error: key }, map).error;
      // Either nothing, or the map's own safe fallback — never a value off
      // Object.prototype, and above all never a function.
      if (entry !== null) {
        expect(typeof entry.message).toBe("string");
        expect(entry.message).toBe("Something went wrong.");
      }
    }
  });

  test.each(maps)("%s drops a duplicated param, which arrives as an array", (_name, map) => {
    // `?error=a&error=b` is a hand-typed URL, not a write that failed, so it is
    // read as absent rather than coerced into "a,b" and looked up.
    expect(readFlash({ error: ["missing", "create"] }, map).error).toBeNull();
  });

  test("the surfaces with no fallback stay silent on a code they don't know", () => {
    // /launch and /invite are single screens reached before any program context;
    // an unknown code there is a URL someone typed, not a failure that happened.
    expect(readFlash({ error: "constructor" }, LAUNCH_FLASH_MAPS).error).toBeNull();
    expect(readFlash({ error: "constructor" }, INVITE_FLASH_MAPS).error).toBeNull();
  });

  test("a code the map DOES define still says what happened", () => {
    expect(readFlash({ error: "create" }, LAUNCH_FLASH_MAPS).error?.message).toContain(
      "couldn't create",
    );
    expect(readFlash({ error: "accept" }, INVITE_FLASH_MAPS).error?.message).toContain(
      "invite",
    );
  });

  test("the surfaces that must not go quiet fall back rather than say nothing", () => {
    // A stale or renamed code on Settings means a write really did fail, and
    // staff who see nothing assume it worked.
    const flash = readFlash({ error: "renamed_last_year" }, SETTINGS_FLASH_MAPS);
    expect(flash.error?.section).toBe("program");
    expect(flash.error?.message).toBe("Something went wrong.");
  });
});
