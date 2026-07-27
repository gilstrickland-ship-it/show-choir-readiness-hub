// Server-side return-path allow-list (Constitution I — a redirect target is
// never taken from the client). A create/edit form rendered somewhere OTHER than
// its own module page posts an opaque `from` KEY; this maps that key to a path
// we own. An unknown or absent key resolves to null, and the action keeps its
// existing module-page redirect byte-for-byte.
//
// Deliberately tiny: two surfaces host these borrowed forms today (the Season
// page's quick-add drawer + row-edit popovers, and Today's start-season card).
// Adding a third means adding it here, on the server, on purpose.

export const RETURN_SURFACES = ["season", "dashboard"] as const;
export type ReturnSurface = (typeof RETURN_SURFACES)[number];

const SURFACE_PATH: Record<ReturnSurface, string> = {
  season: "season",
  dashboard: "dashboard",
};

export function isReturnSurface(value: string): value is ReturnSurface {
  return (RETURN_SURFACES as readonly string[]).includes(value);
}

// The absolute path for an allow-listed key, or null when the caller sent
// nothing (the module-page flow) or something we don't recognize.
export function returnPath(slug: string, from: string): string | null {
  const key = from.trim();
  if (!isReturnSurface(key)) return null;
  return `/${slug}/${SURFACE_PATH[key]}`;
}
