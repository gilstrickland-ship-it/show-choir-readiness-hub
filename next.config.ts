import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Scope build tracing to this app; the repo root holds the legacy prototype's
  // own lockfile, which Next would otherwise flag as ambiguous.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
