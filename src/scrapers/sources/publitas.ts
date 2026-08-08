// src/scrapers/sources/publitas.ts
// Shared helpers for reading a Publitas leaflet hosted on view.publitas.com — the
// "image-first" flavour where a publication is a set of page IMAGES, each with an
// OCR'd `text` blob, served from a single `spreads.json`. Vomar's folder uses this
// shape (see sources/vomar.ts); a future PLUS Publitas fallback could reuse it too.
//
// NB: this is a DIFFERENT Publitas deployment from Hoogvliet's. Hoogvliet reads a
// self-hosted folder host (folder.hoogvliet.com/<folderId>/…) whose spreads carry
// clickable product `hotspots_data.json` linking to real product pages, and it
// never touches OCR text — so sources/hoogvliet.ts deliberately keeps its own
// inline logic and does not import this module (folding the two together would buy
// nothing and risk regressing a live store). This module is the view.publitas.com
// OCR-folder path only.
//
// Everything network-touching is isolated in the `fetch*` functions; the parsing
// helpers are pure so they can be unit-tested against saved fixtures.

const VIEW_ORIGIN = "https://view.publitas.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Types mirroring the parts of spreads.json we use ----------------------

/** One leaflet page: an OCR `text` blob plus image variants keyed by size. */
export interface PublitasPage {
  /** Page number as printed in the leaflet (1-based). */
  number: number;
  id: number;
  /** OCR'd page text. Column order is unreliable (see vomar.discovery.md). */
  text: string;
  /** Size key ("at2400" | "at1600" | …) → root-relative image path. */
  images: Record<string, string>;
}

interface Spread {
  pages?: PublitasPage[];
}

// --- Pure parsing helpers (exported for testing) ---------------------------

/**
 * The Publitas group/publication ids embedded in a publication's HTML, from the
 * asset path `…/production-revolution-publitas-com/<gId>/<pId>/…`. These identify
 * the publication for the (rarely populated) hotspots API; they rotate weekly, so
 * never hardcode them — always resolve at scrape time. Returns null if not found.
 */
export function parsePublicationIds(html: string): { gId: string; pId: string } | null {
  const m = html.match(/production-revolution-publitas-com\/(\d+)\/(\d+)/);
  return m ? { gId: m[1], pId: m[2] } : null;
}

/** Flatten a spreads.json array into a flat, page-ordered list of pages. */
export function flattenPages(spreads: unknown): PublitasPage[] {
  if (!Array.isArray(spreads)) return [];
  const pages: PublitasPage[] = [];
  for (const spread of spreads as Spread[]) {
    for (const p of spread.pages ?? []) {
      if (p && typeof p.text === "string" && typeof p.number === "number") pages.push(p);
    }
  }
  return pages;
}

/**
 * Build an absolute image URL for a page, preferring the first available size in
 * `preferred` (largest-first by default). Publitas serves root-relative resize
 * paths, so we prefix the view host. Returns null if the page has no image.
 */
export function pageImageUrl(
  page: PublitasPage,
  preferred: readonly string[] = ["at1600", "at2000", "at1200", "at2400"],
): string | null {
  const images = page.images ?? {};
  const key = preferred.find((k) => images[k]) ?? Object.keys(images)[0];
  if (!key) return null;
  const path = images[key];
  return path.startsWith("http") ? path : `${VIEW_ORIGIN}${path}`;
}

// --- Network (impure) -------------------------------------------------------

/**
 * Follow a Publitas embed shortlink (e.g. `view.publitas.com/<slug>?publitas_embed=…`)
 * to the resolved publication URL (`…/<slug>/<publication>/`). The base (query
 * stripped, trailing slash ensured) is what `spreads.json` hangs off.
 */
export async function resolvePublicationBase(shortlink: string): Promise<string> {
  const res = await fetch(shortlink, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${shortlink} → ${res.status}`);
  const u = new URL(res.url);
  u.search = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

/** Fetch the resolved publication's HTML (for id/validity extraction). */
export async function fetchPublicationHtml(publicationBase: string): Promise<string> {
  return httpText(publicationBase);
}

/** Fetch and flatten a publication's `spreads.json` into ordered pages. */
export async function fetchPages(publicationBase: string): Promise<PublitasPage[]> {
  const json = JSON.parse(await httpText(`${publicationBase}spreads.json`));
  return flattenPages(json);
}

/** Download a page image as a base64 data payload (for vision extraction). */
export async function fetchImageBase64(
  url: string,
): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const mediaType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mediaType };
}
