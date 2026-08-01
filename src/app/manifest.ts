import type { MetadataRoute } from "next";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/config";

// PWA web app manifest (App Router file convention → served at
// /manifest.webmanifest, and the <link rel="manifest"> is injected for us).
// Icons and theme colour come from the Bonusfinder brand kit in /public/brand.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "nl-NL",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#147a50",
    icons: [
      {
        src: "/brand/bonusfinder-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/bonusfinder-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
