// The one statement of "a search engine may not have this" (§8a, Constitution
// II). The tokenized parent surface has no login — the URL IS the credential —
// so nothing under /t/ may be indexed, followed, or cached by a crawler that
// picks a token up from a toolbar, a referrer chain, or a pasted link.
//
// Why a header and not only the page metadata: `metadata.robots` in the /t/
// layout becomes a <meta> tag, which exists only in an HTML response. The
// subtree also serves the parent packet PDF, the per-competition .ics and the
// season calendar feed from ROUTE HANDLERS, and a PDF is a first-class
// indexable document that names students against hotel rooms. Those responses
// carry no <head>, so the directive has to travel in the response headers.
//
// Set once, in middleware, for the whole subtree (middleware.ts) — so a route
// added under /t/ tomorrow is covered the day it is written, and the header and
// the meta tag cannot disagree. Restated in robots.txt (app/robots.ts) for the
// crawlers that read that first and never issue the request at all.

export const NOINDEX_PREFIX = "/t/";

export const NOINDEX_HEADER = "X-Robots-Tag";

// noindex: never list it. nofollow: never walk the links on it (a family page
// links to the packet and the ICS, which are the same secret). noarchive: no
// cached copy served after the link is revoked.
export const NOINDEX_VALUE = "noindex, nofollow, noarchive";

// True for any request path inside the anonymous token surface.
export function isNoIndexPath(pathname: string): boolean {
  return pathname.startsWith(NOINDEX_PREFIX);
}
