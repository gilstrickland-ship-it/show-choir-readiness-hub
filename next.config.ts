import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Scope build tracing to this app; the repo root holds the legacy prototype's
  // own lockfile, which Next would otherwise flag as ambiguous.
  outputFileTracingRoot: __dirname,
  // Retired routes whose URLs are still in bookmarks and browser history. A
  // config redirect rather than a page that only redirects: there is no surface
  // here, so there should be no route file pretending there is (a stub like
  // that is exactly what /costumes/alterations decayed into).
  async redirects() {
    return [
      {
        // Wardrobe went from six tabs to four (spec 005 US13): a costume set is
        // the grouping assignments hang off, so sets CRUD lives on Assignments.
        source: "/:program/costumes/sets",
        destination: "/:program/costumes/assignments",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
