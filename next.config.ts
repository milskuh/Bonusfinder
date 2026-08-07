import type { NextConfig } from "next";

// Baseline security headers applied to every response. CSP is intentionally
// omitted here: Clerk injects scripts/frames/connections from several origins, so
// a wrong CSP silently breaks auth. Add it later in report-only mode first, e.g.
// `Content-Security-Policy-Report-Only`, once the Clerk origins are pinned.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Product/supermarket images come from external hosts. Loosen this to the
  // specific CDNs you scrape once they're known; the wildcard keeps dev simple.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
