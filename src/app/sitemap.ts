import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Served at /sitemap.xml (App Router file convention). Only the public,
// indexable routes belong here — the offers feed is the single crawlable page;
// /basket and /favorites are per-user (auth-gated) and the sign-in/up routes
// carry no content, so they're intentionally left out (and blocked in robots).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
