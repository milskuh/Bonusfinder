/**
 * App-wide branding constants — single source of truth for the visible
 * product name. "Bonusfinder" is a proper noun and stays identical in NL/EN.
 */
export const APP_NAME = "Bonusfinder";

/**
 * Homepage / default `<title>` — the brand name alone ("Bonusfinder") carries no
 * search keywords, so the landing page gets a keyword-rich title instead. Inner
 * pages keep the `%s · Bonusfinder` template (see layout.tsx). ~59 chars keeps it
 * under Google's ~60-char desktop truncation.
 */
export const APP_TITLE_DEFAULT =
  "Bonusfinder – Supermarktaanbiedingen & bonussen op één plek";

/**
 * Meta description — kept to ~155 chars (Google's snippet width) and stocked with
 * the terms people actually search (supermarktaanbiedingen, bonuskortingen, store
 * names) so Google shows this instead of scraping the on-page nav labels.
 */
export const APP_DESCRIPTION =
  "Vergelijk alle supermarktaanbiedingen en bonuskortingen van Albert Heijn, Jumbo, Lidl, Aldi, Dirk en meer — gebundeld op één plek en dagelijks bijgewerkt.";

/**
 * Canonical, absolute site origin (no trailing slash). Drives `metadataBase`,
 * the sitemap and robots.txt so Google indexes one canonical host. Override per
 * environment with NEXT_PUBLIC_SITE_URL (e.g. a Vercel preview URL); defaults to
 * the production domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bonusfinder.nu"
).replace(/\/$/, "");
