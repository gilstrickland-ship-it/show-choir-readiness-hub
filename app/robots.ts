import type { MetadataRoute } from "next";
import { NOINDEX_PREFIX } from "@/lib/no-index";

// robots.txt. The second half of the no-index control (lib/no-index): the
// X-Robots-Tag header in middleware answers a crawler that has already fetched
// a family's URL; this stops the well-behaved ones before they ask.
//
// Only /t/ is disallowed. Everything else is a marketing or sign-in surface
// that SHOULD be findable — /link-help in particular, which is deliberately
// outside the token subtree so a parent who lost their link can search for it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: NOINDEX_PREFIX,
    },
  };
}
