// src/scrapers/sources/gall.ts
// Scraper for Gall & Gall (the Ahold Delhaize liquor chain), driven by the
// server-rendered "acties" (promotions) category pages — plain-HTTP + cheerio,
// like sources/dirk.ts.
//
// gall.nl is a Salesforce Commerce Cloud (SFCC/Demandware) storefront. It is NOT
// an AH-style JSON app API: the offers are server-rendered as `.ptile` product
// tiles, and — very conveniently — each tile carries a structured `data-product`
// JSON attribute (the analytics payload) with clean fields:
//   { name, brand, price (the normal price), discount (€ off), category (a
//     "Wijn/Rosé wijn/…" path), variant ("75CL"), promotionName }
// so the sale price is simply `price − discount`. The visible `.ptile_badges`
// span carries the human promo label ("2e halve prijs", "OP=OP", …).
//
// Breadth without touching Disallowed paths: SFCC's infinite grid pages via
// `?start=` (robots-Disallowed, along with `Product-Show`, `?srule=`, `?prefn`,
// `/*_*`), so we DON'T paginate. Instead we read `/acties` and every clean
// `/acties/<category>/` sub-page it links to (wijn, whisky, bier, gin, …) — each
// serves its own first page of tiles — and dedupe by product id. That yields the
// full breadth (~250 offers) using only Allowed, query-param-free paths.
//
// robots.txt (verified 2026-08-06): `User-agent: *` Disallows checkout, search
// (`/zoeken`, `?q=`), filter params and the SFCC `*-Show` controllers, but the
// `/acties/**` category paths are Allowed; `ClaudeBot`/`anthropic-ai` are even
// listed explicitly under the allowed AI crawlers. We stay gentle: sequential
// requests, a ~1s pause between pages, a realistic desktop user-agent.
//
// Validity: Gall promos run multi-week (this one "geldig t/m zondag 23 augustus",
// folder "wk 32-33-34"), so — unlike a weekly ad — we must give every offer ONE
// stable validFrom that stays in a single ISO week across the whole run, or a
// re-scrape in a later week would land the same product in a new week bucket and
// duplicate it (see offer-plan.ts). We read the end date off `/acties/folders/`
// and derive validFrom deterministically from it (never from the scrape day), so
// it never drifts. Category is name-first (categorize()), falling back to Gall's
// own category path — mostly DRANKEN, which is correct for a liquor store.
import * as cheerio from "cheerio";
import { Category } from "@prisma/client";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.gall.nl";
const ACTIES_URL = `${ORIGIN}/acties`;
const FOLDERS_URL = `${ORIGIN}/acties/folders/`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REQUEST_DELAY_MS = 1000; // polite pause between category-page requests.
const MAX_PAGES = 40; // safety cap on how many /acties/<cat>/ pages we walk.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Pure parsing helpers (exported for testing) ---------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The `data-product` analytics payload we read off each tile (loosely typed). */
export interface GallProduct {
  name?: string;
  id?: string;
  price?: number;
  discount?: number;
  brand?: string;
  category?: string;
  variant?: string;
  promotionName?: string;
}

/**
 * Map Gall's top-level category-path segment ("Wijn/…" → "Wijn") to a Category.
 * Used only as a FALLBACK when the product name has no keyword — most Gall names
 * are brand names ("Jameson", "Bacardí") with no drink word. A liquor store is
 * ~entirely alcohol, so unmapped drink segments default to ALCOHOL. The exception
 * is the alcohol-free aisle ("Alcoholvrij"/"Alcoholarm"), which is soft drinks.
 */
export function mapGallCategory(categoryPath: string | undefined): Category | null {
  const top = (categoryPath ?? "").split("/")[0].trim().toLowerCase();
  if (!top) return null;
  // Non-drink Gall aisles that should NOT be forced into a drink category.
  if (/cadeau|accessoire|geschenk|glas|boek|waardebon|overig/.test(top)) return null;
  // Alcohol-free beer/wine/mixers etc. are soft drinks, not ALCOHOL.
  if (/alcoholvrij|alcoholarm/.test(top)) return Category.SODA;
  // Everything else on gall.nl is alcohol (wijn, bier, whisky, gin, rum, jenever,
  // likeur, port, cognac, mixen, premix, cocktail, mousserend, …).
  return Category.ALCOHOL;
}

/** Badges that describe a multi-buy mechanic → offerText only, never a synthetic %. */
function isMultibuyBadge(badge: string | null): boolean {
  if (!badge) return false;
  return /\b(2e|2de|tweede|1\s*\+\s*1|2\s*\+\s*1|gratis|halve|stapel)\b/i.test(badge);
}

/**
 * Map one Gall tile (its parsed `data-product` + visible promo badge) to a
 * ScrapedOffer, or null when it isn't a real offer. Sale price is `price −
 * discount`; a badge-only multi-buy (e.g. "2e halve prijs", where per-unit
 * discount is 0) keeps the shelf price and rides on offerText — normalize.ts
 * suppresses any synthetic discount for it.
 */
export function tileToOffer(
  dp: GallProduct,
  badge: string | null,
  deepLink: string | null,
  imageUrl: string | null,
  validFrom: Date,
  validUntil: Date,
): ScrapedOffer | null {
  const name = dp.name?.trim();
  if (!name) return null;
  const price = typeof dp.price === "number" ? dp.price : null;
  if (price == null || price <= 0) return null;

  const discount = typeof dp.discount === "number" ? dp.discount : 0;
  const hasPriceCut = discount > 0;
  const multibuy = isMultibuyBadge(badge);

  // Not a real offer: no price cut AND no promo badge → skip (filler tile).
  if (!hasPriceCut && !badge) return null;

  const saleRaw = hasPriceCut ? round2(price - discount) : price;
  // Feed original only for a genuine straight cut; for a multi-buy badge leave it
  // null so normalize can't derive a misleading per-unit %. offerText carries the
  // deal in that case.
  const originalIn = hasPriceCut && !multibuy ? price : null;
  const norm = normalizePrice({ salePrice: saleRaw, originalPrice: originalIn, offerText: badge });

  // Category for a liquor store. Order matters:
  //  1. Alcohol-free aisle ("alcoholvrij"/"alcoholarm") → SODA, never ALCOHOL,
  //     even when the name still says "bier"/"wijn" (a 0.0 variant).
  //  2. A drink keyword in the name wins (wijn→ALCOHOL, cola mixer→SODA, water→DRANKEN).
  //  3. Else Gall's own aisle decides (ALCOHOL) — this OVERRIDES a food bucket a
  //     name keyword produced ("STËLZ Mango" is a drink, not FRUIT).
  //  4. Else (gift/accessory aisle) keep the name's honest bucket.
  const gallCat = mapGallCategory(dp.category);
  const byName = categorize(name, [dp.category, dp.brand]);
  let category: Category;
  if (gallCat === Category.SODA) category = Category.SODA;
  else if (byName === Category.ALCOHOL || byName === Category.SODA || byName === Category.DRANKEN) category = byName;
  else if (gallCat === Category.ALCOHOL) category = Category.ALCOHOL;
  else category = byName;

  const { contentAmount, contentUnit } = parseVariant(dp.variant);

  return {
    name,
    brand: dp.brand?.trim() || null,
    category,
    subcategory: dp.category ?? null,
    imageUrl,
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

/**
 * Parse Gall's `variant` pack size ("75CL", "100CL", "70CL", "1.5L", "1ST") to a
 * base unit. Volumes normalise to litres; a bare piece count ("1ST") → stuk.
 */
export function parseVariant(variant: string | undefined): {
  contentAmount: number | null;
  contentUnit: string | null;
} {
  if (!variant) return { contentAmount: null, contentUnit: null };
  const s = variant.toLowerCase().replace(",", ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(cl|ml|l|st|stuks?|x)?/);
  if (!m) return { contentAmount: null, contentUnit: null };
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return { contentAmount: null, contentUnit: null };
  switch (m[2]) {
    case "cl":
      return { contentAmount: round3(value / 100), contentUnit: "l" };
    case "ml":
      return { contentAmount: round3(value / 1000), contentUnit: "l" };
    case "l":
      return { contentAmount: value, contentUnit: "l" };
    case "st":
    case "stuk":
    case "stuks":
      return { contentAmount: value, contentUnit: "stuk" };
    default:
      return { contentAmount: null, contentUnit: null };
  }
}

// --- Validity (exported for testing) ---------------------------------------

const DUTCH_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, maa: 2, mrt: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};

const dayStart = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const dayEnd = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/**
 * Parse Gall's promo end date from the folder page. The period is stated in the
 * banner's alt text, e.g. "geldig t/m zondag 23 augustus" → 23 Aug (end of day).
 * The year is inferred with a Dec→Jan roll. Returns null when not found.
 */
export function parseActieEndDate(html: string, today = new Date()): Date | null {
  const m = html.match(/t\/m\s+\w+\s+(\d{1,2})\s+([a-zA-Z]+)/i);
  if (!m) return null;
  const month = DUTCH_MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (month == null) return null;
  let d = new Date(today.getFullYear(), month, Number(m[1]));
  if (d.getTime() < today.getTime() - 60 * 864e5) d = new Date(today.getFullYear() + 1, month, Number(m[1]));
  return dayEnd(d);
}

/**
 * A stable validity window for a Gall actie from its end date. validFrom is the
 * Monday of the ISO week two weeks before the end — a fixed function of the (fixed)
 * end date, so every scrape during the multi-week actie yields the SAME validFrom
 * and its offers keep updating one row instead of duplicating across week buckets.
 * Falls back to a two-week window ending today+14d when the end date is unknown.
 */
export function actiePeriod(endDate: Date | null, today = new Date()): { validFrom: Date; validUntil: Date } {
  const validUntil = endDate ?? dayEnd(new Date(today.getTime() + 14 * 864e5));
  const anchor = new Date(validUntil.getTime() - 14 * 864e5);
  // Monday 00:00 of the anchor's week (Mon=0 … Sun=6).
  const monday = dayStart(anchor);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return { validFrom: monday, validUntil };
}

// --- Page parsing (exported for testing) -----------------------------------

/** Widest image URL from a tile's srcset ("url 60w, url 200w" → last), else src. */
function bestImage(srcset: string | undefined, src: string | undefined): string | null {
  if (srcset) {
    const parts = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return src && !/placeholder/.test(src) ? src : null;
}

/**
 * Parse one Gall category/acties page into ScrapedOffers, keyed by product id so
 * the caller can dedupe across pages. Only tiles that are real offers (a price cut
 * or a promo badge) are returned.
 */
export function parseActiePage(
  html: string,
  validFrom: Date,
  validUntil: Date,
): Map<string, ScrapedOffer> {
  const $ = cheerio.load(html);
  const byId = new Map<string, ScrapedOffer>();

  $(".ptile[data-product]").each((_, el) => {
    const tile = $(el);
    let dp: GallProduct;
    try {
      dp = JSON.parse(tile.attr("data-product") || "");
    } catch {
      return;
    }
    if (!dp?.id) return;

    const badge = tile.closest(".c-product").find(".ptile_badges").text().replace(/\s+/g, " ").trim() || null;
    const href = tile.find("a.ptile_link").first().attr("href") || null;
    const deepLink = href ? new URL(href, ORIGIN).toString() : null;
    const img = tile.find("img.img, img").first();
    const imageUrl = bestImage(img.attr("srcset"), img.attr("src"));

    const offer = tileToOffer(dp, badge, deepLink, imageUrl, validFrom, validUntil);
    if (offer && !byId.has(dp.id)) byId.set(dp.id, offer);
  });

  return byId;
}

/** Collect the clean `/acties/<category>/` sub-page URLs linked from /acties. */
export function collectActieCategoryUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    // Only single-segment /acties/<cat>/ paths, no query params, no folders page.
    if (/^\/acties\/[^/?]+\/$/.test(href) && !/\/acties\/folders\//.test(href)) {
      urls.add(new URL(href, ORIGIN).toString());
    }
  });
  return [...urls];
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const today = new Date();

  // 1. The actie period end date (for a stable, non-drifting validity window).
  let endDate: Date | null = null;
  try {
    endDate = parseActieEndDate(await httpText(FOLDERS_URL), today);
  } catch (err) {
    if (process.env.SCRAPE_DEBUG) console.error(`  [gall] folders page: ${(err as Error).message}`);
  }
  const { validFrom, validUntil } = actiePeriod(endDate, today);
  if (process.env.SCRAPE_DEBUG) {
    console.error(`  [gall] period ${validFrom.toISOString().slice(0, 10)} → ${validUntil.toISOString().slice(0, 10)}`);
  }

  // 2. The /acties landing page + every clean /acties/<category>/ sub-page.
  const landingHtml = await httpText(ACTIES_URL);
  const pages = [ACTIES_URL, ...collectActieCategoryUrls(landingHtml)].slice(0, MAX_PAGES);

  const byId = new Map<string, ScrapedOffer>();
  for (const [id, offer] of parseActiePage(landingHtml, validFrom, validUntil)) byId.set(id, offer);

  let first = true;
  for (const url of pages) {
    if (url === ACTIES_URL) continue; // already parsed the landing page above
    if (!first) await sleep(REQUEST_DELAY_MS);
    first = false;
    try {
      const html = await httpText(url);
      const page = parseActiePage(html, validFrom, validUntil);
      let added = 0;
      for (const [id, offer] of page) if (!byId.has(id)) (byId.set(id, offer), added++);
      if (process.env.SCRAPE_DEBUG) console.error(`  [gall] ${url.replace(ORIGIN, "")}: +${added} (total ${byId.size})`);
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [gall] ${url}: ${(err as Error).message}`);
    }
  }

  const offers = [...byId.values()];
  if (process.env.SCRAPE_DEBUG) console.error(`  [gall] ${offers.length} offers total`);
  if (offers.length === 0) {
    throw new Error("No Gall & Gall offers found (page structure may have changed).");
  }
  return offers;
}

export const gall: Scraper = {
  slug: "gall",
  name: "Gall & Gall",
  logoUrl: "/logos/gall.jpg",
  scrape,
};
