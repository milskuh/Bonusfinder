// src/scrapers/sources/vomar.ts
// Scraper for Vomar, driven by its weekly digital FOLDER on Publitas. Unlike
// Hoogvliet's Publitas folder (whose hotspots link to structured product pages),
// Vomar's is IMAGE-FIRST: the publication is a set of page images, each with an
// OCR'd `text` blob and NO product hotspots or price API (see vomar.discovery.md).
// So this scraper is a small folder-reading engine with graceful fallbacks:
//
//   Tier 1  Publitas hotspots           — structured, but Vomar publishes none
//                                          today; kept so it lights up for free if
//                                          Vomar ever turns product hotspots on.
//   Tier 2  Publitas' own OCR text       — keyless, no AI cost; lower recall, so it
//                                          favours precision (emit only name+price).
//   Tier 3  Vision extraction of the      — the accurate path for messy promo art,
//           page images via Claude          gated behind ANTHROPIC_API_KEY (the same
//                                            key translate.ts already uses).
//
// The scrape prefers vision when a key is present, else falls back to the OCR text.
// It degrades rather than crashing when a tier is unavailable, and never invents a
// price — a tile with no clear price/mechanism is skipped (repo policy: no fake data).
//
// Validity: Vomar's main folder rolls Wednesday (Wed–Tue); a "weekendfolder"
// sub-leaflet runs Thu–Sun. The publication slug carries the ISO week ("…week-32"),
// which we turn into a stable window — stable so a re-scrape in the same period
// keeps one row per offer instead of drifting across week buckets (offer-plan.ts).
import Anthropic from "@anthropic-ai/sdk";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";
import {
  fetchImageBase64,
  fetchPages,
  fetchPublicationHtml,
  parsePublicationIds,
  pageImageUrl,
  resolvePublicationBase,
  type PublitasPage,
} from "./publitas";

const THIS_WEEK_EMBED = "https://view.publitas.com/folder-deze-week?publitas_embed=maximized";
const VISION_MODEL = "claude-sonnet-5"; // vision-capable; cheaper than Opus for bulk pages.
const MAX_VISION_PAGES = 30; // safety cap on how many page images we send.
const REQUEST_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Validity (pure, exported for testing) ---------------------------------

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
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Monday 00:00 of ISO week `week` in `year` (ISO week 1 is the week with Jan 4). */
export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7; // Mon=0 … Sun=6
  const week1Monday = new Date(year, 0, 4 - jan4Dow);
  return dayStart(addDays(week1Monday, (week - 1) * 7));
}

/**
 * A stable validity window for a Vomar folder from its ISO week and kind. Weekly
 * folders run Wed→Tue; the weekend sub-folder runs Thu→Sun. The year is inferred
 * (the slug carries only the week): of the three candidate years we pick the one
 * whose window sits nearest `today`, which handles the Dec↔Jan boundary. Because
 * the window is a pure function of the (fixed) week, every scrape in the period
 * yields the same validFrom — no week-bucket drift across re-scrapes.
 */
export function periodFromWeek(
  week: number,
  weekend: boolean,
  today = new Date(),
): { validFrom: Date; validUntil: Date } {
  const candidate = (year: number) => {
    const monday = isoWeekMonday(year, week);
    return weekend
      ? { validFrom: dayStart(addDays(monday, 3)), validUntil: dayEnd(addDays(monday, 6)) } // Thu–Sun
      : { validFrom: dayStart(addDays(monday, 2)), validUntil: dayEnd(addDays(monday, 8)) }; // Wed–Tue
  };
  const dist = (w: { validFrom: Date }) => Math.abs(w.validFrom.getTime() - today.getTime());
  const y = today.getFullYear();
  return [candidate(y - 1), candidate(y), candidate(y + 1)].sort((a, b) => dist(a) - dist(b))[0];
}

/**
 * Resolve the ids, page count and validity window from a publication's HTML. Ids
 * come from the Publitas asset path; the page count from the embedded `numPages`;
 * validity from the ISO week in the slug (a "weekend" slug uses the Thu–Sun
 * window). Falls back to a Wed–Tue window around today when the week isn't found.
 */
export function resolvePublication(
  html: string,
  today = new Date(),
): { gId: string | null; pId: string | null; pageCount: number; validFrom: Date; validUntil: Date } {
  const ids = parsePublicationIds(html);
  const pageCount = Number(html.match(/"numPages":\s*(\d+)/)?.[1] ?? 0);
  const week = Number(html.match(/week[-_](\d{1,2})\b/i)?.[1] ?? 0);
  const weekend = /weekend/i.test(html);
  const validity = week
    ? periodFromWeek(week, weekend, today)
    : { validFrom: dayStart(today), validUntil: dayEnd(addDays(today, 6)) };
  return { gId: ids?.gId ?? null, pId: ids?.pId ?? null, pageCount, ...validity };
}

// --- Offer construction (pure, exported for testing) -----------------------

interface Validity {
  validFrom: Date;
  validUntil: Date;
}

/** Assemble a ScrapedOffer from extracted fields, or null if it has no name. */
function buildOffer(
  o: {
    name: string;
    brand?: string | null;
    salePrice?: number | null;
    originalPrice?: number | null;
    offerText?: string | null;
    contentAmount?: number | null;
    contentUnit?: string | null;
  },
  v: Validity,
): ScrapedOffer | null {
  const name = o.name.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const sale = typeof o.salePrice === "number" && o.salePrice > 0 ? o.salePrice : null;
  // A tile is only a real offer if it has a price OR a promo mechanism.
  if (sale == null && !o.offerText) return null;

  const price =
    sale != null
      ? normalizePrice({
          salePrice: sale,
          originalPrice: typeof o.originalPrice === "number" ? o.originalPrice : null,
          offerText: o.offerText ?? null,
        })
      : { salePrice: null, originalPrice: null, discountPercent: null, offerText: o.offerText ?? null };

  return {
    name,
    brand: o.brand?.trim() || null,
    category: categorize(name, [o.brand]),
    subcategory: null,
    imageUrl: null, // folder images are full pages, not per-product
    deepLink: null, // no per-product URL in the folder
    salePrice: price.salePrice,
    originalPrice: price.originalPrice,
    discountPercent: price.discountPercent,
    offerText: price.offerText,
    contentAmount: o.contentAmount ?? null,
    contentUnit: o.contentUnit ?? null,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
  };
}

/** Parse a leaflet price token to euros: "2.79" → 2.79, "1.-" → 1.00, "1,49" → 1.49. */
export function parseLeafletPrice(token: string): number | null {
  const s = token.replace(/\s+/g, "").replace(",", ".");
  const dashEuro = s.match(/^€?(\d+)\.-$/); // "1.-" = whole euros
  if (dashEuro) return Number(dashEuro[1]);
  const m = s.match(/^€?(\d+\.\d{2})$/);
  return m ? Number(m[1]) : null;
}

type Hotspot = { type?: string; product?: { title?: string; price?: number }; url?: string };

/**
 * Tier 1 — map Publitas product hotspots to offers. Vomar publishes none today, so
 * this returns [] for the usual empty input; kept so the scraper benefits for free
 * if Vomar ever enables shoppable hotspots.
 */
export function offersFromHotspots(json: unknown, v: Validity): ScrapedOffer[] {
  if (!Array.isArray(json)) return [];
  const offers: ScrapedOffer[] = [];
  for (const h of json as Hotspot[]) {
    const title = h.product?.title?.trim();
    if (!title || h.type !== "product") continue;
    const offer = buildOffer(
      { name: title, salePrice: typeof h.product?.price === "number" ? h.product.price : null },
      v,
    );
    if (offer) offers.push(offer);
  }
  return offers;
}

const MECHANISM_RE =
  /(\d+\s*\+\s*\d+\s*gratis|gratis|2e\s+halve\s+prijs|halve\s+prijs|\d+\s*%\s*korting|\d+\s+voor\s+[\d.,]+|op\s*=\s*op|weekendwinner)/i;
const DATE_LINE_RE = /^\d{1,2}\s+(jan|feb|maa|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)/i;
// Lines that are packaging/quantity/leaflet-copy, never a product name → dropped
// from the name buffer (they must not leak into an emitted offer's name).
const NOISE_RE =
  /^(per\s|los$|bak\b|pak\b|zak\b|schaal\b|krat\b|set\b|stuk|kilo|gram|maat|sortering|prijsvoorbeeld|m\.u\.v|alle\s+soorten|voor\s+circa|kies\s+uit|bijv|van\s+.*\s+tot|alléén|alleen\b|geldig|acties)/i;
// Day-of-week shouts ("Alléén op donderdag…"), promo exclamations and ellipses are
// leaflet copy, not products — a name touching these is rejected outright.
const NON_PRODUCT_RE = /[!…]|\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i;

/**
 * A conservative "is this actually a product name?" gate for the Tier-2 heuristic.
 * The OCR text interleaves columns, so we only trust a name that reads like one:
 * short, carries a Capitalised word, and isn't leaflet copy. Favours precision.
 */
function looksLikeProduct(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  if (NON_PRODUCT_RE.test(name)) return false;
  if (/^(alle|per|van|met|voor|tot|of|en|bij|circa)\b/i.test(name)) return false;
  return /\b[A-Z][a-zà-ÿ]/.test(name); // at least one Capitalised word
}

/**
 * Tier 2 — parse offers from a page's OCR text (no AI, no cost). The Publitas text
 * is a jumbled multi-column stream, so this favours PRECISION over recall: it emits
 * an offer only when a run of "name" lines is immediately followed by a price token
 * (optionally with a promo mechanism nearby), and skips everything ambiguous. Lower
 * recall than vision — a keyless fallback, not the primary path.
 */
export function offersFromPublitasText(pageText: string, v: Validity): ScrapedOffer[] {
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const offers: ScrapedOffer[] = [];
  let nameBuf: string[] = [];
  let mechanism: string | null = null;

  const flush = (price: number) => {
    // Keep only wordy name lines (drop stray labels/sizes that slipped into the buffer).
    const words = nameBuf.filter((l) => /[a-z]{3,}/i.test(l) && !NOISE_RE.test(l));
    const name = words.join(" ").replace(/\s+/g, " ").trim();
    if (looksLikeProduct(name)) {
      const offer = buildOffer({ name, salePrice: price, offerText: mechanism }, v);
      if (offer) offers.push(offer);
    }
    nameBuf = [];
    mechanism = null;
  };

  for (const line of lines) {
    const price = parseLeafletPrice(line);
    if (price != null) {
      if (nameBuf.length) flush(price);
      continue;
    }
    const mech = line.match(MECHANISM_RE);
    if (mech) {
      mechanism = mech[0].replace(/\s+/g, " ").trim();
      continue;
    }
    if (DATE_LINE_RE.test(line) || NOISE_RE.test(line)) continue;
    if (/[a-z]/i.test(line)) nameBuf.push(line);
    // A run that never reaches a price is dropped when the next price flushes.
    if (nameBuf.length > 4) nameBuf.shift();
  }
  return offers;
}

/** The strict JSON item shape the vision model is asked to return. */
interface ExtractedItem {
  name?: unknown;
  brand?: unknown;
  salePrice?: unknown;
  originalPrice?: unknown;
  offerText?: unknown;
  contentAmount?: unknown;
  contentUnit?: unknown;
}

/**
 * Tier 3 — map the vision (or OCR) model's JSON items to ScrapedOffers. Defensive:
 * skips rows with no usable name and coerces prices to finite numbers, so a
 * malformed/hallucinated row is dropped rather than persisted.
 */
export function offersFromExtractedItems(items: unknown, v: Validity): ScrapedOffer[] {
  if (!Array.isArray(items)) return [];
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null;
  const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
  const unit = (x: unknown): string | null =>
    x === "kg" || x === "l" || x === "stuk" ? x : null;

  const offers: ScrapedOffer[] = [];
  for (const raw of items as ExtractedItem[]) {
    const name = str(raw?.name);
    if (!name) continue;
    const offer = buildOffer(
      {
        name,
        brand: str(raw?.brand),
        salePrice: num(raw?.salePrice),
        originalPrice: num(raw?.originalPrice),
        offerText: str(raw?.offerText),
        contentAmount: num(raw?.contentAmount),
        contentUnit: unit(raw?.contentUnit),
      },
      v,
    );
    if (offer) offers.push(offer);
  }
  return offers;
}

// --- Vision (impure) --------------------------------------------------------

/** True when an Anthropic API key is available (Tier 3 is gated behind it). */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const VISION_PROMPT =
  "You are extracting supermarket leaflet offers from this page image. Return ONLY " +
  "a JSON array, no prose and no markdown fences. Each item: " +
  '{ "name": string, "brand"?: string, "salePrice"?: number, "originalPrice"?: number, ' +
  '"offerText"?: string, "contentAmount"?: number, "contentUnit"?: "kg"|"l"|"stuk" }. ' +
  "Prices are euros as numbers. For multi-buy deals (\"1+1 gratis\", \"2e halve prijs\", " +
  '"N voor P", "N% korting") leave salePrice/originalPrice null and put the mechanism in ' +
  "offerText. Omit non-products (spaaracties, recipes, store info, adverts). If the page " +
  "has no offers, return [].";

/** Strip stray ``` fences and pull the first JSON array out of a model reply. */
function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
}

/** Send one page image to the vision model and return its extracted items. */
async function visionExtractPage(
  client: Anthropic,
  image: { base64: string; mediaType: string },
): Promise<unknown> {
  const res = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4000,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType as "image/jpeg" | "image/png",
              data: image.base64,
            },
          },
          { type: "text", text: VISION_PROMPT },
        ],
      },
    ],
  });
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  return extractJsonArray(text);
}

// --- Orchestration ----------------------------------------------------------

/** Read one folder embed into offers, trying each tier until one yields data. */
async function readFolder(embedUrl: string): Promise<ScrapedOffer[]> {
  const base = await resolvePublicationBase(embedUrl);
  const html = await fetchPublicationHtml(base);
  const meta = resolvePublication(html);
  const v: Validity = { validFrom: meta.validFrom, validUntil: meta.validUntil };
  const pages = await fetchPages(base);
  if (process.env.SCRAPE_DEBUG) {
    console.error(
      `  [vomar] ${base} — ${pages.length} pages, valid ${meta.validFrom.toISOString().slice(0, 10)}→${meta.validUntil.toISOString().slice(0, 10)}`,
    );
  }

  // Tier 1: hotspots (expected empty for Vomar today, but free to try).
  try {
    const hs = await fetch(`${base}hotspots.json`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (hs.ok) {
      const offers = offersFromHotspots(await hs.json(), v);
      if (offers.length) {
        if (process.env.SCRAPE_DEBUG) console.error(`  [vomar] Tier1 hotspots: ${offers.length}`);
        return offers;
      }
    }
  } catch {
    // no hotspots layer → fall through
  }

  // Tier 3: vision, when a key is present (the accurate path).
  if (hasApiKey()) {
    try {
      const client = new Anthropic();
      const offers: ScrapedOffer[] = [];
      const targets = pages.slice(0, MAX_VISION_PAGES);
      for (const page of targets) {
        const url = pageImageUrl(page);
        if (!url) continue;
        try {
          const image = await fetchImageBase64(url);
          const items = await visionExtractPage(client, image);
          offers.push(...offersFromExtractedItems(items, v));
        } catch (err) {
          if (process.env.SCRAPE_DEBUG) console.error(`  [vomar] vision page ${page.number}: ${(err as Error).message}`);
        }
        await sleep(REQUEST_DELAY_MS);
      }
      if (offers.length) {
        if (process.env.SCRAPE_DEBUG) console.error(`  [vomar] Tier3 vision: ${offers.length}`);
        return dedupe(offers);
      }
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [vomar] vision unavailable: ${(err as Error).message}`);
    }
  }

  // Tier 2: Publitas OCR text (keyless fallback, lower recall).
  const offers: ScrapedOffer[] = [];
  for (const page of pages) offers.push(...offersFromPublitasText(page.text, v));
  if (process.env.SCRAPE_DEBUG) console.error(`  [vomar] Tier2 OCR text: ${offers.length}`);
  return dedupe(offers);
}

/** Drop duplicate offers (same name+price) that recur across pages/spreads. */
function dedupe(offers: ScrapedOffer[]): ScrapedOffer[] {
  const byKey = new Map<string, ScrapedOffer>();
  for (const o of offers) {
    const key = `${o.name.toLowerCase()}|${o.salePrice ?? ""}|${o.offerText ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, o);
  }
  return [...byKey.values()];
}

async function scrape(): Promise<ScrapedOffer[]> {
  const offers = await readFolder(THIS_WEEK_EMBED);
  if (offers.length === 0) {
    throw new Error(
      "No Vomar offers parsed from the folder (structure changed, or run with ANTHROPIC_API_KEY for the vision path).",
    );
  }
  return offers;
}

export const vomar: Scraper = {
  slug: "vomar",
  name: "Vomar",
  logoUrl: "/logos/vomar.svg",
  scrape,
};
