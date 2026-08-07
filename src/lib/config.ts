/**
 * App-wide branding constants — single source of truth for the visible
 * product name. "Bonusfinder" is a proper noun and stays identical in NL/EN.
 */
export const APP_NAME = "Bonusfinder";
export const APP_DESCRIPTION = "Alle supermarktbonussen op één plek.";

/**
 * Canonical, absolute site origin (no trailing slash). Drives `metadataBase`,
 * the sitemap and robots.txt so Google indexes one canonical host. Override per
 * environment with NEXT_PUBLIC_SITE_URL (e.g. a Vercel preview URL); defaults to
 * the production domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bonusfinder.nu"
).replace(/\/$/, "");
