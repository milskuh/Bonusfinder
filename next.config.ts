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
  // No `images.remotePatterns` on purpose: every next/image use renders a local
  // /brand/*.svg asset (unoptimized), and product/logo images use plain <img>
  // with an onError fallback — so nothing goes through the image optimizer. A
  // wildcard here would turn /_next/image into an open proxy for any host. If a
  // remote next/image is ever added, allowlist only that specific host below.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
