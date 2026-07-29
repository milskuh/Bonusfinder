// src/scrapers/sources/hoogvliet.ts
// Scraper for Hoogvliet, driven by the weekly digital FOLDER (the leaflet), so
// we capture *all* advertised deals — not just the online-orderable subset the
// webshop's promotion endpoint surfaces.
//
// The folder is a Publitas publication embedded at
//   https://folder.hoogvliet.com/folder_<year>_<week>/
// Its per-spread `hotspots_data.json` lists clickable "spots", each linking to a
// deal's product page: https://www.hoogvliet.com/aanbiedingen/<articleId>.
// We collect every article id from the hotspots, then fetch each product page
// and parse the deal from its server-rendered HTML.
//
// robots.txt: this approach only touches ALLOWED paths — `/aanbiedingen/<id>`
// product pages and the Publitas folder JSON. It never hits the Disallowed
// `/INTERSHOP/` webshop endpoints. We stay gentle regardless: one request at a
// time, a 1–2s delay (REQUEST_DELAY_MS) and a realistic desktop user-agent.
//
// Plain HTTP is enough (no headless browser): both hosts serve these responses
// without a bot challenge. Parsing uses cheerio; price→discount normalisation
// lives in ../normalize.
import * as cheerio from "cheerio";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.hoogvliet.com";
const FOLDER_ORIGIN = "https://folder.hoogvliet.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REQUEST_DELAY_MS = 1500; // polite pause between requests (1–2s).
const MAX_SPREADS = 60; // safety cap when walking folder spreads.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Polite HTTP ------------------------------------------------------------

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function httpJson<T>(url: string): Promise<T> {
  return JSON.parse(await httpText(url)) as T;
}

// --- Pure parsing helpers (exported for testing) ---------------------------

const DUTCH_MONTHS: Record<string, number> = {
  januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
  juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
};

/** Extract euro amounts from a price blob, tolerating the "2. 09" split markup. */
export function priceNumbers(text: string | null): number[] {
  if (!text) return [];
  const compact = text.replace(/\s+/g, "");
  const matches = compact.match(/\d+[.,]\d{2}/g) ?? [];
  return matches.map((m) => parseFloat(m.replace(",", ".")));
}

/** Parse a pack size out of the description, normalised to kg / l / stuk. */
export function parseContent(description: string | null): {
  contentAmount: number | null;
  contentUnit: string | null;
} {
  if (!description) return { contentAmount: null, contentUnit: null };
  const m = description
    .toLowerCase()
    .match(/(\d+(?:[.,]\d+)?)\s*(?:-\s*\d+(?:[.,]\d+)?\s*)?(kilogram|kilo|kg|gram|gr|g|liter|litre|ml|cl|l|stuks|stuk)\b/);
  if (!m) return { contentAmount: null, contentUnit: null };
  const value = parseFloat(m[1].replace(",", "."));
  switch (m[2]) {
    case "kilogram": case "kilo": case "kg": return { contentAmount: value, contentUnit: "kg" };
    case "gram": case "gr": case "g": return { contentAmount: value / 1000, contentUnit: "kg" };
    case "liter": case "litre": case "l": return { contentAmount: value, contentUnit: "l" };
    case "ml": return { contentAmount: value / 1000, contentUnit: "l" };
    case "cl": return { contentAmount: value / 100, contentUnit: "l" };
    case "stuks": case "stuk": return { contentAmount: value, contentUnit: "stuk" };
    default: return { contentAmount: null, contentUnit: null };
  }
}

/**
 * Parse the product page's validity line, e.g.
 * "Aanbieding is geldig van 29 juli t/m 04 augustus", into a date window. The
 * year is inferred; a Dec→Jan wrap rolls the end date into the next year.
 */
export function parseValidity(text: string | null, today = new Date()): { validFrom: Date; validUntil: Date } {
  const m = text?.match(/(\d{1,2})\s+([a-z]+)\s+t\/?m\s+(\d{1,2})\s+([a-z]+)/i);
  if (!m) {
    return { validFrom: today, validUntil: new Date(today.getTime() + 7 * 864e5) };
  }
  const [, d1, mo1, d2, mo2] = m;
  const year = today.getFullYear();
  const from = new Date(year, DUTCH_MONTHS[mo1.toLowerCase()] ?? 0, Number(d1), 0, 0, 0);
  let until = new Date(year, DUTCH_MONTHS[mo2.toLowerCase()] ?? 0, Number(d2), 23, 59, 59);
  if (until < from) until = new Date(year + 1, until.getMonth(), until.getDate(), 23, 59, 59);
  return { validFrom: from, validUntil: until };
}

/**
 * Parse a Hoogvliet product/offer page into a ScrapedOffer. Returns null if the
 * page isn't a usable promotion (no deal tile or no sale price).
 */
export function parseDeal(html: string, articleId: string, today = new Date()): ScrapedOffer | null {
  const $ = cheerio.load(html);
  const tile = $(".promotionProductTile").first();
  if (tile.length === 0) return null;

  const txt = (sel: { text(): string }) => sel.text().replace(/\s+/g, " ").trim() || null;
  const name = txt(tile.find("h1").first());
  if (!name) return null;
  const description = txt(tile.find("h1").first().next());
  const offerText = txt($(".promotion-short-title").first());

  const saleNums = [...new Set(tile.find(".non-strikethrough").map((_, e) => $(e).text()).get().flatMap(priceNumbers))];
  if (saleNums.length === 0) return null;
  const salePrice = Math.min(...saleNums);
  const origNums = priceNumbers(txt(tile.find(".strikethrough").first()));
  const originalPrice = origNums.length ? Math.min(...origNums) : null;

  const price = normalizePrice({ salePrice, originalPrice, offerText });
  const { contentAmount, contentUnit } = parseContent(description);
  const { validFrom, validUntil } = parseValidity(txt($(".pdp-date-range").first()), today);

  const imgSrc =
    $('img[data-image-src*="/ACT/"]').first().attr("data-image-src") ||
    $('img[src*="/ACT/"]').first().attr("src") ||
    null;

  return {
    name,
    brand: null,
    category: categorize(name, [description]),
    subcategory: null,
    imageUrl: imgSrc ? new URL(imgSrc, ORIGIN).toString() : null,
    deepLink: `${ORIGIN}/aanbiedingen/${articleId}`,
    salePrice: price.salePrice,
    originalPrice: price.originalPrice,
    discountPercent: price.discountPercent,
    offerText: price.offerText,
    contentAmount,
    contentUnit,
    validFrom,
    validUntil,
  };
}

/** Spread path labels for a folder: "1", "2-3", "4-5", … for `spreadCount` spreads. */
export function spreadLabels(spreadCount: number): string[] {
  const labels = ["1"];
  for (let k = 2; k <= spreadCount; k++) labels.push(`${2 * (k - 1)}-${2 * (k - 1) + 1}`);
  return labels;
}

// --- Discovery --------------------------------------------------------------

/**
 * Find the current folder id (e.g. "folder_2026_31") from the folder landing
 * page. The page mixes a link to the current folder ("folder-2026-31") with the
 * occasional stale reference, and uses both dash and underscore forms, so we
 * collect every "folder<sep>YEAR<sep>WEEK" and pick the newest (year, week),
 * returning the underscore form used by the folder.hoogvliet.com host.
 */
export function pickFolderId(html: string): string | null {
  const matches = [...html.matchAll(/folder[-_](\d{4})[-_](\d{1,2})/g)];
  if (matches.length === 0) return null;
  const best = matches
    .map((m) => ({ year: Number(m[1]), week: Number(m[2]) }))
    .sort((a, b) => b.year - a.year || b.week - a.week)[0];
  return `folder_${best.year}_${best.week}`;
}

async function currentFolderId(): Promise<string> {
  const id = pickFolderId(await httpText(`${ORIGIN}/folder`));
  if (!id) throw new Error("Could not find the current folder id on /folder.");
  return id;
}

type Hotspot = { type?: string; url?: string };

/** Collect every distinct offer article id from the folder's hotspots. */
async function collectArticleIds(folderId: string): Promise<string[]> {
  const spreads = await httpJson<unknown[]>(`${FOLDER_ORIGIN}/${folderId}/spreads.json?page=1`);
  const count = Array.isArray(spreads) ? Math.min(spreads.length, MAX_SPREADS) : MAX_SPREADS;

  const ids = new Set<string>();
  let firstRequest = true;
  for (const label of spreadLabels(count)) {
    if (!firstRequest) await sleep(REQUEST_DELAY_MS);
    firstRequest = false;
    try {
      const hotspots = await httpJson<Hotspot[]>(
        `${FOLDER_ORIGIN}/${folderId}/page/${label}/hotspots_data.json?page=1`,
      );
      for (const h of hotspots) {
        const id = h.url?.match(/\/aanbiedingen\/(\d+)/)?.[1];
        if (id) ids.add(id);
      }
    } catch {
      // Some spreads have no hotspots layer (recipe/ad pages) → skip.
    }
  }
  return [...ids];
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const folderId = await currentFolderId();
  if (process.env.SCRAPE_DEBUG) console.error(`  [hoogvliet] folder: ${folderId}`);

  const articleIds = await collectArticleIds(folderId);
  if (process.env.SCRAPE_DEBUG) console.error(`  [hoogvliet] ${articleIds.length} deals in folder`);
  if (articleIds.length === 0) {
    throw new Error(`No deals found in Hoogvliet folder ${folderId} (structure may have changed).`);
  }

  const offers: ScrapedOffer[] = [];
  for (const id of articleIds) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await httpText(`${ORIGIN}/aanbiedingen/${id}`);
      const offer = parseDeal(html, id);
      if (offer) offers.push(offer);
      else if (process.env.SCRAPE_DEBUG) console.error(`  [hoogvliet] ${id}: no parseable deal, skipped`);
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [hoogvliet] ${id}: ${(err as Error).message}`);
    }
  }
  return offers;
}

export const hoogvliet: Scraper = {
  slug: "hoogvliet",
  name: "Hoogvliet",
  logoUrl: "https://logo.clearbit.com/hoogvliet.com",
  scrape,
};
