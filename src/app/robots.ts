import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Served at /robots.txt (App Router file convention). Lets search engines crawl
// the public offers feed while keeping API routes and per-user / auth pages out
// of the index, and points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/sign-in", "/sign-up", "/basket", "/favorites"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
