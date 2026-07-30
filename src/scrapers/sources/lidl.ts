// src/scrapers/sources/lidl.ts
// Scraper for Lidl's weekly offers.
//
// NOTE ON THE PLAN: the brief expected lidl.nl to be walled off (crawl-blocked,
// backend API only). Verified live on 2026-07-30 that this is NOT the case:
//   - robots.txt only Disallows /cqe/*, /user-api/*, and a set of query-param
//     patterns (?offset=, id=, sort=, …). The offers *page* is not disallowed.
//   - A plain fetch of the offers page returns HTTP 200 with NO bot challenge,
//     and the products are server-rendered INLINE in the HTML as
//     `data-grid-data="{…}"` attributes (HTML-entity-encoded JSON) on each tile.
// So there is no need for the app/backend API at all: we fetch two pages
// (homepage → offers page) and parse the inlined product JSON — gentle, plain
// HTTP, robots-permitted. (See lidl.discovery.md.)
//
// Lidl exposes a real was→now price, so — like Hoogvliet and Aldi — prices flow
// through the shared normalize.ts for the one canonical discount rule.
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.lidl.nl";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REQUEST_DELAY_MS = 1200; // polite pause between the two requests.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Types mirroring the parts of the tile JSON we use ---------------------

interface LidlProduct {
  productId?: string;
  itemId?: string;
  title?: string;
  fullTitle?: string;
  brand?: { showBrand?: boolean; name?: string };
  productType?: string;
  isLidlGiftCard?: boolean;
  preventSelling?: boolean;
  havingPrice?: boolean;
  canonicalPath?: string;
  canonicalUrl?: string;
  image?: string;
  imageList_V1?: { image?: string }[];
  storeStartDate?: number; // unix seconds
  storeEndDate?: number; // unix seconds
  price?: {
    price?: number;
    oldPrice?: number;
    packaging?: { text?: string };
    discount?: { deletedPrice?: number };
  };
}

// --- Parsing (pure, exported for testing) ----------------------------------

const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The current offers page URL, discovered from the homepage (id rotates). */
export function discoverOffersUrl(homepageHtml: string): string | null {
  const found = [...homepageHtml.matchAll(/\/c\/aanbiedingen\/a\d+/g)].map((m) => m[0]);
  if (found.length === 0) return null;
  const counts = new Map<string, number>();
  for (const u of found) counts.set(u, (counts.get(u) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return new URL(best, ORIGIN).toString();
}

const hasPrice = (p: LidlProduct | undefined): boolean => typeof p?.price?.price === "number";

/**
 * Parse the inline `data-grid-data` product JSON from an offers page, deduped
 * by productId. A product can appear more than once (e.g. a price-less teaser
 * tile plus the real priced tile), so we prefer the priced occurrence rather
 * than blindly keeping the first — otherwise a teaser could shadow the price.
 */
export function parseGridData(html: string): LidlProduct[] {
  const byId = new Map<string, LidlProduct>();
  for (const m of html.matchAll(/data-grid-data="([^"]*)"/g)) {
    let obj: LidlProduct;
    try {
      obj = JSON.parse(decodeEntities(m[1]));
    } catch {
      continue;
    }
    const id = obj?.productId ?? obj?.itemId ?? obj?.fullTitle;
    if (id == null) continue;
    const key = String(id);
    const existing = byId.get(key);
    if (!existing || (hasPrice(obj) && !hasPrice(existing))) byId.set(key, obj);
  }
  return [...byId.values()];
}

// --- Mapping (pure, exported for testing) ----------------------------------

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Parse Lidl's `packaging.text` ("200 g", "0.5 l", "2 x 250 g") to kg/l/stuk. */
export function parseLidlContent(text: string | null | undefined): {
  contentAmount: number | null;
  contentUnit: string | null;
} {
  if (!text) return { contentAmount: null, contentUnit: null };
  const s = text.toLowerCase().replace(",", ".");
  const unitRe = "(kg|gram|g|liter|litre|l|ml|cl|stuks|stuk)";
  const mult = s.match(new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  const single = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  let value: number;
  let unit: string;
  if (mult) {
    value = Number(mult[1]) * Number(mult[2]);
    unit = mult[3];
  } else if (single) {
    value = Number(single[1]);
    unit = single[2];
  } else {
    return { contentAmount: null, contentUnit: null };
  }
  switch (unit) {
    case "kg":
      return { contentAmount: value, contentUnit: "kg" };
    case "gram":
    case "g":
      return { contentAmount: round3(value / 1000), contentUnit: "kg" };
    case "liter":
    case "litre":
    case "l":
      return { contentAmount: value, contentUnit: "l" };
    case "ml":
      return { contentAmount: round3(value / 1000), contentUnit: "l" };
    case "cl":
      return { contentAmount: round3(value / 100), contentUnit: "l" };
    case "stuks":
    case "stuk":
      return { contentAmount: value, contentUnit: "stuk" };
    default:
      return { contentAmount: null, contentUnit: null };
  }
}

/** Unix seconds → Date, or null. */
function unixToDate(sec: number | undefined): Date | null {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/** Map one Lidl product tile to a ScrapedOffer, or null if not a usable offer. */
export function productToOffer(product: LidlProduct, today = new Date()): ScrapedOffer | null {
  if (product.havingPrice === false || product.isLidlGiftCard || product.preventSelling) return null;
  if (product.productType && product.productType !== "RETAIL") return null;

  const name = (product.fullTitle || product.title)?.trim();
  if (!name) return null;

  const salePrice = typeof product.price?.price === "number" ? product.price.price : null;
  if (salePrice == null || salePrice <= 0) return null;

  // Real was-price: prefer the discount's deletedPrice, else oldPrice.
  const wasRaw = product.price?.discount?.deletedPrice ?? product.price?.oldPrice;
  const originalPrice = typeof wasRaw === "number" && wasRaw > salePrice ? wasRaw : null;

  // One canonical discount rule for every source.
  const norm = normalizePrice({ salePrice, originalPrice, offerText: null });

  const { contentAmount, contentUnit } = parseLidlContent(product.price?.packaging?.text);
  const image = product.imageList_V1?.[0]?.image || product.image || null;
  const path = product.canonicalPath || product.canonicalUrl;
  const deepLink = path ? new URL(path, ORIGIN).toString() : null;
  const validFrom = unixToDate(product.storeStartDate) ?? today;
  const validUntil = unixToDate(product.storeEndDate) ?? new Date(today.getTime() + 7 * 864e5);

  return {
    name,
    brand: product.brand?.name?.trim() || null,
    category: categorize(name, [product.price?.packaging?.text]),
    subcategory: null, // Lidl only tags a coarse "Food"/"Nonfood" here
    imageUrl: image,
    deepLink,
    salePrice: norm.salePrice,
    originalPrice: norm.originalPrice,
    discountPercent: norm.discountPercent,
    offerText: norm.offerText,
    contentAmount,
    contentUnit,
    validFrom,
    validUntil,
  };
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const homepage = await httpText(`${ORIGIN}/`);
  const offersUrl = discoverOffersUrl(homepage);
  if (!offersUrl) throw new Error("Lidl: could not find the aanbiedingen URL on the homepage.");
  if (process.env.SCRAPE_DEBUG) console.error(`  [lidl] offers page: ${offersUrl}`);

  await sleep(REQUEST_DELAY_MS);
  const html = await httpText(offersUrl);
  const products = parseGridData(html);
  if (process.env.SCRAPE_DEBUG) console.error(`  [lidl] ${products.length} product tiles`);

  const today = new Date();
  const byKey = new Map<string, ScrapedOffer>();
  for (const product of products) {
    const offer = productToOffer(product, today);
    if (!offer) continue;
    const key = product.productId ?? offer.name;
    if (!byKey.has(key)) byKey.set(key, offer);
  }

  const offers = [...byKey.values()];
  if (process.env.SCRAPE_DEBUG) console.error(`  [lidl] ${offers.length} offers`);
  if (offers.length === 0) {
    throw new Error("No Lidl offers found (page structure may have changed).");
  }
  return offers;
}

export const lidl: Scraper = {
  slug: "lidl",
  name: "Lidl",
  logoUrl: "https://logo.clearbit.com/lidl.nl",
  scrape,
};
