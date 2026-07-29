// Server-side return-path allow-list (Constitution I — a redirect target is
// never taken from the client). A create/edit form rendered somewhere OTHER than
// its own module page posts an opaque `from` KEY; this maps that key to a path
// we own. An unknown or absent key resolves to null, and the action keeps its
// existing module-page redirect byte-for-byte.
//
// Deliberately tiny, and every entry is added here, on the server, on purpose.
// The first two host the Season page's quick-add drawer + row-edit popovers and
// Today's start-season card. The rest are the season-scoped surfaces that render
// the SAME start-season card when a program has no active season (T143g), so a
// director who starts one from the money or wardrobe page lands back on it
// rather than being teleported to Today.

export const RETURN_SURFACES = [
  "season",
  "dashboard",
  "treasury",
  "commitments",
  "assignments",
  "ensembles",
] as const;
export type ReturnSurface = (typeof RETURN_SURFACES)[number];

const SURFACE_PATH: Record<ReturnSurface, string> = {
  season: "season",
  dashboard: "dashboard",
  treasury: "treasury",
  commitments: "treasury/commitments",
  assignments: "costumes/assignments",
  // The card renders on ONE ensemble's page, whose id this key cannot carry —
  // the list is the honest landing place.
  ensembles: "roster/ensembles",
};

export function isReturnSurface(value: string): value is ReturnSurface {
  return (RETURN_SURFACES as readonly string[]).includes(value);
}

// The shape `slugify` mints in app/launch/actions.ts: lowercase letters, digits
// and inner hyphens. Validating it is what keeps the interpolation below a PATH
// — a form that posted slug="/evil.com" would otherwise produce
// "//evil.com/season", which every browser reads as a protocol-relative URL and
// follows off-site. Anything that isn't a slug fails closed.
const PROGRAM_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function isProgramSlug(value: string): boolean {
  return PROGRAM_SLUG.test(value);
}

// An absolute in-app path for a program, or null when `slug` isn't a program
// slug. Callers that need a redirect target MUST treat null as "don't build one"
// rather than falling back to their own interpolation.
export function programPath(slug: string, path: string): string | null {
  if (!isProgramSlug(slug)) return null;
  return `/${slug}/${path}`;
}

// The program's ROOT path — what `revalidatePath(…, "layout")` is given when a
// write changes the tenant shell (the header prints the active season's label).
// Separate from programPath because that one always appends a segment, and
// `/demo/` is not the same cache key as `/demo`.
export function programRoot(slug: string): string | null {
  if (!isProgramSlug(slug)) return null;
  return `/${slug}`;
}

// The absolute path for an allow-listed key, or null when the caller sent
// nothing (the module-page flow), something we don't recognize, or a slug that
// isn't a slug.
export function returnPath(slug: string, from: string): string | null {
  const key = from.trim();
  if (!isReturnSurface(key)) return null;
  return programPath(slug, SURFACE_PATH[key]);
}
