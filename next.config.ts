import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product/supermarket images come from external hosts. Loosen this to the
  // specific CDNs you scrape once they're known; the wildcard keeps dev simple.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
