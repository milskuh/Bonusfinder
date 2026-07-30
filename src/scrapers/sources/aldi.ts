// src/scrapers/sources/aldi.ts
// Scraper for Aldi's weekly offers.
//
// aldi.nl is a Next.js app; the folder page is a graphical iPaper leaflet (page
// images, no data). But the offers page — aldi.nl/aanbiedingen.html — is
// server-rendered and inlines a FULLY STRUCTURED offer feed in its Next payload:
//   __NEXT_DATA__.props.pageProps.apiData  (a JSON string) →
//   [ ["OFFER_GET", { res: { algoliaDataMap: { <id>: <product>, … } } }], … ]
// Each product has a real price, an optional strike-through (was) price, a base
// (per-kg/l) price, its own category, image and validity window. So we do ONE
// GET and parse that — no headless browser, no OCR of leaflet images.
//
// Because Aldi gives a real was→now price, this is the one new source with
// genuine discounts: we route price/was/offerText through the shared
// normalize.ts, exactly like Hoogvliet, so discountPercent is computed by the
// one canonical rule (and multi-buys keep salePrice only).
//
// robots.txt (verified 2026-07-30): aldi.nl Disallows some region pages
// (/reg-*, /can/, /bal/, /mds/) and filtered/query URLs, but NOT
// /aanbiedingen.html. One plain GET with a desktop UA is within the rules.
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.aldi.nl";
const OFFERS_URL = `${ORIGIN}/aanbiedingen.html`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Types mirroring the parts of the feed we use --------------------------

interface AldiPrice {
  priceValue?: number;
  strikePrice?: { strikePriceValue?: number };
  basePrice?: { basePriceValue?: number; basePriceScale?: string }[];
  priceTagLabels?: { promoText1?: string };
  validFrom?: number; // unix seconds
  validUntil?: number; // unix seconds
}
export interface AldiProduct {
  objectID?: string;
  name?: string;
  brandName?: string;
  isAvailable?: boolean;
  salesUnit?: string;
  mainCategoryID?: string;
  productSlug?: string;
  assets?: { type?: string; url?: string }[];
  currentPrice?: AldiPrice;
  promotionPrices?: AldiPrice[];
}

// --- Parsing (pure, exported for testing) ----------------------------------

/** Pull the current-week product list out of the inlined Next.js offer feed. */
export function parseAldiOffers(html: string): AldiProduct[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Aldi: __NEXT_DATA__ not found (page structure changed).");

  let nextData: unknown;
  try {
    nextData = JSON.parse(m[1]);
  } catch {
    throw new Error("Aldi: __NEXT_DATA__ was not valid JSON.");
  }

  let apiData = (nextData as { props?: { pageProps?: { apiData?: unknown } } })?.props?.pageProps
    ?.apiData;
  if (typeof apiData === "string") {
    try {
      apiData = JSON.parse(apiData);
    } catch {
      throw new Error("Aldi: pageProps.apiData was not valid JSON.");
    }
  }
  if (!Array.isArray(apiData)) throw new Error("Aldi: unexpected apiData shape.");

  const entry = apiData.find((e) => Array.isArray(e) && e[0] === "OFFER_GET") as
    | [string, { res?: { algoliaDataMap?: Record<string, AldiProduct> } }]
    | undefined;
  const map = entry?.[1]?.res?.algoliaDataMap;
  if (!map || typeof map !== "object") {
    throw new Error("Aldi: OFFER_GET algoliaDataMap not found.");
  }
  return Object.values(map);
}

// --- Mapping (pure, exported for testing) ----------------------------------

/** Dutch money string for an offerText, e.g. 3 → "3,00". */
function dutchEuro(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Unix seconds → Date, or null. */
function unixToDate(sec: number | undefined): Date | null {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Map one Aldi product to a ScrapedOffer, or null if it isn't a usable offer.
 * Prices flow through normalize.ts: a strike-through price yields a real
 * discountPercent; a "N VOOR" tag is treated as a multi-buy (bundle price kept
 * in salePrice, no synthesised percentage).
 */
export function productToOffer(product: AldiProduct, today = new Date()): ScrapedOffer | null {
  const name = product.name?.trim();
  if (!name) return null;
  if (product.isAvailable === false) return null;

  const price = product.currentPrice ?? product.promotionPrices?.[0];
  const salePrice = typeof price?.priceValue === "number" ? price.priceValue : null;
  if (salePrice == null || salePrice <= 0) return null;

  const strike = price?.strikePrice?.strikePriceValue;
  const originalPrice = typeof strike === "number" ? strike : null;

  // "2 VOOR" etc.: priceValue is the bundle price for N (matches AH X-for-Y).
  // Build the offerText so normalize keeps salePrice and drops the (bundle) was
  // price rather than inventing a percentage.
  const promoText1 = price?.priceTagLabels?.promoText1?.trim() ?? "";
  const nFor = promoText1.match(/^(\d+)\s*voor$/i);
  const offerTextIn = nFor ? `${nFor[1]} voor ${dutchEuro(salePrice)}` : null;

  const norm = normalizePrice({ salePrice, originalPrice, offerText: offerTextIn });

  // Recover the pack size from Aldi's own base (per-kg/l) price so persist.ts
  // reproduces the same unit price. Skip multi-buys (salePrice is a bundle).
  let contentAmount: number | null = null;
  let contentUnit: string | null = null;
  const base = price?.basePrice?.[0];
  if (!nFor && base && typeof base.basePriceValue === "number" && base.basePriceValue > 0) {
    contentAmount = round3(salePrice / base.basePriceValue);
    contentUnit = base.basePriceScale ?? null;
  }

  const image =
    (product.assets?.find((a) => a.type === "primary") ?? product.assets?.[0])?.url ?? null;
  const deepLink = product.productSlug ? `${ORIGIN}/product/${product.productSlug}.html` : null;
  const validFrom = unixToDate(price?.validFrom) ?? today;
  const validUntil = unixToDate(price?.validUntil) ?? new Date(today.getTime() + 7 * 864e5);

  return {
    name,
    brand: product.brandName?.trim() || null,
    category: categorize(name, [product.brandName, product.salesUnit, product.mainCategoryID]),
    subcategory: product.mainCategoryID ?? null,
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
  const html = await httpText(OFFERS_URL);
  const products = parseAldiOffers(html);
  if (process.env.SCRAPE_DEBUG) console.error(`  [aldi] ${products.length} products in feed`);

  const today = new Date();
  const byKey = new Map<string, ScrapedOffer>();
  for (const product of products) {
    const offer = productToOffer(product, today);
    if (!offer) continue;
    const key = product.objectID ?? offer.name;
    if (!byKey.has(key)) byKey.set(key, offer);
  }

  const offers = [...byKey.values()];
  if (process.env.SCRAPE_DEBUG) console.error(`  [aldi] ${offers.length} offers`);
  if (offers.length === 0) {
    throw new Error("No Aldi offers found (page structure may have changed).");
  }
  return offers;
}

export const aldi: Scraper = {
  slug: "aldi",
  name: "Aldi",
  logoUrl: "https://logo.clearbit.com/aldi.nl",
  scrape,
};
