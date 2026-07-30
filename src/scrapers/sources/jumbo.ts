// src/scrapers/sources/jumbo.ts
// Scraper for Jumbo's weekly offers.
//
// jumbo.com/aanbiedingen/nu is a Nuxt (Vue) SSR app. The offer list is not
// fetched by a client-side XHR we can call — it is server-rendered and inlined
// into the page as a Nuxt payload (`<script id="__NUXT_DATA__">`), a JSON array
// in devalue's flat/indexed form. So we do the gentlest thing possible: ONE
// GET of the page, then parse the inlined payload — no headless browser, no
// pagination, no extra requests.
//
// Jumbo is promotion-centric like Albert Heijn: each tile is a promotion whose
// deal lives in a text `tag` ("1+1 gratis", "2 voor 6,00", "voor 1,99",
// "25% korting", …). There is no structured per-unit price, so salePrice is set
// only when the tag is a plain/fixed price ("voor X", "N voor P") and stays null
// for percentage / euro-off / multi-buy-mechanic deals — exactly as
// normalize.ts prescribes; we never synthesise a price or percentage.
//
// robots.txt (verified 2026-07-30): jumbo.com only Disallows internal keyword
// search and login/personal pages — `/aanbiedingen/` is allowed. One request
// with a realistic desktop UA is well within that.
import { categorize } from "../categorize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.jumbo.com";
const OFFERS_URL = `${ORIGIN}/aanbiedingen/nu`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Nuxt payload parsing (pure, exported for testing) ---------------------

/** The Promotion shape we read out of the Nuxt payload (loosely typed). */
export interface JumboPromotion {
  __typename?: string;
  id?: string;
  uuid?: string;
  title?: string;
  subtitle?: string | null;
  group?: string;
  active?: boolean;
  hidden?: boolean;
  image?: string | null;
  url?: string | null;
  start?: { iso?: string } | null;
  end?: { iso?: string } | null;
  tags?: { text?: string; inverse?: boolean }[];
}

/**
 * Rebuild a value from Nuxt's devalue payload: a flat array in which every
 * object/array field value is an *index* into the array (so shared values are
 * stored once). We resolve those indices back into a normal object graph.
 * Memoised so cycles terminate.
 */
export function unflattenNuxtData(flat: unknown[]): unknown {
  const hydrated = new Array(flat.length);
  const done = new Array(flat.length).fill(false);
  function hydrate(index: unknown): unknown {
    if (typeof index !== "number" || index < 0 || index >= flat.length) return undefined;
    if (done[index]) return hydrated[index];
    done[index] = true;
    const value = flat[index];
    if (value === null || typeof value !== "object") {
      hydrated[index] = value;
      return value;
    }
    if (Array.isArray(value)) {
      const arr: unknown[] = [];
      hydrated[index] = arr;
      for (const el of value) arr.push(hydrate(el));
      return arr;
    }
    const obj: Record<string, unknown> = {};
    hydrated[index] = obj;
    for (const key of Object.keys(value as object)) {
      obj[key] = hydrate((value as Record<string, unknown>)[key]);
    }
    return obj;
  }
  return hydrate(0);
}

/** Extract, parse, and unflatten the __NUXT_DATA__ payload; collect Promotions. */
export function parsePromotions(html: string): JumboPromotion[] {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Jumbo: __NUXT_DATA__ payload not found (page structure changed).");

  let flat: unknown[];
  try {
    flat = JSON.parse(m[1]);
  } catch {
    throw new Error("Jumbo: __NUXT_DATA__ payload was not valid JSON.");
  }

  const root = unflattenNuxtData(flat);
  const promotions: JumboPromotion[] = [];
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if ((node as JumboPromotion).__typename === "Promotion") {
      promotions.push(node as JumboPromotion);
    }
    for (const key of Object.keys(node as object)) stack.push((node as Record<string, unknown>)[key]);
  }
  return promotions;
}

// --- Deal-tag interpretation (pure, exported for testing) ------------------

// Channel/modifier tags carry no price ("Alleen online", "Alleen in de
// slijterij"); the deal is in the other tag.
const CHANNEL_TAG = /^alleen\b/i;

/** The single promo tag from a tile's tags, skipping channel modifiers. */
export function pickPromoTag(tags: { text?: string }[] | undefined | null): string | null {
  for (const t of tags ?? []) {
    const text = t?.text?.trim();
    if (text && !CHANNEL_TAG.test(text)) return text;
  }
  return null;
}

/** Dutch money string → number ("6,00" → 6, "13,99" → 13.99), or null. */
function toEuro(s: string): number | null {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * The single euro sale price a Jumbo tag implies, or null when it has none.
 * - "voor 1,99" / "Voor 0,89"      → the fixed price.
 * - "2 voor 6,00" / "4 voor 10,00" → the bundle price (matches AH's X-for-Y).
 * - "1+1 gratis", "25% korting", "1,00 korting", "2e halve prijs" → null: no
 *   single price, so the deal rides on offerText (never fabricate one).
 */
export function parseJumboPrice(tag: string | null): number | null {
  if (!tag) return null;
  const s = tag.trim();
  let m = s.match(/^voor\s+€?\s*([\d.,]+)$/i);
  if (m) return toEuro(m[1]);
  m = s.match(/^\d+\s+voor\s+€?\s*([\d.,]+)$/i);
  if (m) return toEuro(m[1]);
  return null;
}

/** ISO string → Date, or null if absent/invalid. */
function isoToDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Turn a "/aanbiedingen/slug/id" url into category hint words. */
const deslug = (url: string | null | undefined): string =>
  (url ?? "").replace(/[^a-z0-9]+/gi, " ").trim();

/**
 * Map one Jumbo promotion to a ScrapedOffer, or null when it isn't a usable
 * weekly deal (no title, inactive/hidden, season-long, or no priceable tag).
 */
export function promotionToOffer(promo: JumboPromotion, today = new Date()): ScrapedOffer | null {
  const name = promo.title?.trim();
  if (!name) return null;
  if (promo.active === false || promo.hidden === true) return null;
  // "Seizoen" tiles are season-long marketing banners (valid for months), not a
  // weekly deal — keep them out of a weekly-offers feed.
  if (promo.group === "Seizoen") return null;

  const promoTag = pickPromoTag(promo.tags);
  if (!promoTag) return null; // a tile with no actual deal (e.g. info only)

  const salePrice = parseJumboPrice(promoTag);
  const validFrom = isoToDate(promo.start?.iso) ?? today;
  const validUntil = isoToDate(promo.end?.iso) ?? new Date(today.getTime() + 7 * 864e5);
  const deepLink = promo.url ? new URL(promo.url, ORIGIN).toString() : null;
  const category = categorize(name, [promo.subtitle, deslug(promo.url)]);

  return {
    name,
    brand: null,
    category,
    subcategory: null, // Jumbo's overview has no product department label
    imageUrl: promo.image ?? null,
    deepLink,
    salePrice,
    originalPrice: null, // the overview never exposes a "was" price
    discountPercent: null, // never synthesised from a % tag (see normalize.ts)
    offerText: promoTag,
    contentAmount: null,
    contentUnit: null,
    validFrom,
    validUntil,
  };
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const html = await httpText(OFFERS_URL);
  const promotions = parsePromotions(html);
  if (process.env.SCRAPE_DEBUG) console.error(`  [jumbo] ${promotions.length} promotions in payload`);

  const today = new Date();
  const byKey = new Map<string, ScrapedOffer>();
  for (const promo of promotions) {
    const offer = promotionToOffer(promo, today);
    if (!offer) continue;
    const key = promo.id ?? promo.uuid ?? offer.name;
    if (!byKey.has(key)) byKey.set(key, offer);
  }

  const offers = [...byKey.values()];
  if (process.env.SCRAPE_DEBUG) console.error(`  [jumbo] ${offers.length} weekly offers`);
  if (offers.length === 0) {
    throw new Error("No Jumbo weekly offers found (page structure may have changed).");
  }
  return offers;
}

export const jumbo: Scraper = {
  slug: "jumbo",
  name: "Jumbo",
  logoUrl: "https://logo.clearbit.com/jumbo.com",
  scrape,
};
