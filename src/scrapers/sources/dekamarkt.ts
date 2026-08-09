// src/scrapers/sources/dekamarkt.ts
// Scraper for DekaMarkt, driven by the server-rendered weekly offers page — the
// same plain-HTTP + cheerio approach as sources/dirk.ts and sources/hoogvliet.ts.
//
// dekamarkt.nl is a Nuxt (Vue) app, but the entire weekly ad is server-rendered
// as HTML offer cards, so we never touch the Nuxt payload or the GraphQL gateway
// (web-deka-gateway.dekamarkt.nl) the client uses when signed in: we fetch
//   https://www.dekamarkt.nl/aanbiedingen
// once and parse the DOM with cheerio. (DekaMarkt is Detailresult Groep, like
// Dirk, but its markup is its OWN — `article.product__card`, not Dirk's cards —
// so the two scrapers share no parsing.)
//
// robots.txt (verified 2026-08-06): only `/misc/*` is Disallowed for `*`, then
// `Allow: /` — `/aanbiedingen` is crawlable. Plain `fetch` returns HTTP 200
// (~950 KB) with no bot challenge. We stay gentle regardless: one request, a
// realistic desktop user-agent and `Accept-Language: nl-NL`.
//
// Price shape (see dekamarkt.discovery.md): each card shows a `.chip` promo label
// ("actie! 4,99", "1+1 GRATIS", "2 voor 4,99", "25% KORTING", "per kilo 0,99"),
// a `.prices__offer` sale price (split "3." + "99" spans → 3.99) and an optional
// `.regular-strike` was-price. Crucially DekaMarkt shows an effective *per-unit*
// price even for "1+1 GRATIS"/"2+1 GRATIS" (1.85 vs a 3.70 strike = half), so we
// pass {salePrice, originalPrice, offerText: chip} straight to normalize.ts — its
// isMultiBuyOffer() catches "1+1"/"gratis"/"N voor P" and suppresses the synthetic
// discount, exactly as required. A real "25% KORTING" (1.12 vs 1.49) is a genuine
// per-unit cut and keeps its computed %.
import * as cheerio from "cheerio";
import { Category } from "@prisma/client";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.dekamarkt.nl";
const OFFERS_URL = `${ORIGIN}/aanbiedingen`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function httpText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

// --- Pure price/label helpers (exported for testing) -----------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A euro amount from DekaMarkt's split price markup. The sale price renders as
 * `<span>3.</span><small><span>99</span></small>` (→ "3.99") and the strike as a
 * plain "5.99"; both collapse to a single number once whitespace is removed.
 * Tolerates a comma decimal and a missing-cents "3.-" form. Returns null when
 * there is no parseable amount (e.g. an empty `.regular-strike`).
 */
export function parseDekaPrice(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? round2(v) : null;
}

/**
 * Parse DekaMarkt's `.addition` pack-size subtitle ("Fles 1.5 liter.",
 * "Doos 15 stuks.", "Blik 25 cl.", "Stuk 650 - 675 gram.") to a base unit
 * (kg / l / stuk). A range keeps the LAST number ("650 - 675 gram" → 0.675 kg);
 * anything unparseable → null (best-effort, as in the other sources).
 */
export function parseDekaContent(text: string | null): {
  contentAmount: number | null;
  contentUnit: string | null;
} {
  if (!text) return { contentAmount: null, contentUnit: null };
  const s = text.toLowerCase().replace(",", ".");
  const unitRe = "(kilogram|kilo|kg|gram|gr|g|liter|litre|ml|cl|l|stuks|stuk)";
  // A "N x M unit" multipack multiplies; a "A - B unit" range keeps B (the last).
  const mult = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  const range = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  const single = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  let value: number;
  let unit: string;
  if (mult) {
    value = Number(mult[1]) * Number(mult[2]);
    unit = mult[3];
  } else if (range) {
    value = Number(range[2]);
    unit = range[3];
  } else if (single) {
    value = Number(single[1]);
    unit = single[2];
  } else {
    return { contentAmount: null, contentUnit: null };
  }
  switch (unit) {
    case "kilogram":
    case "kilo":
    case "kg":
      return { contentAmount: value, contentUnit: "kg" };
    case "gram":
    case "gr":
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

/**
 * Map a DekaMarkt department heading (`section.offers__department > h3`) to our
 * Category. Used only as a FALLBACK when the product name yields no keyword (the
 * AH/Dirk pattern). The raw heading is never fed to categorize() — headings like
 * "Vlees, Vis & Vega" hold several category keywords and would mis-fire. Sections
 * with no clean single category ("Extra weekend voordeel", promo aisles) return
 * null → the item keeps its name-based category.
 */
export function mapDekaSectionCategory(heading: string | undefined): Category | null {
  // Keys are the live headings verbatim (lowercased); a couple of plausible
  // variants are kept alongside. Aisles that mix categories ("Extra weekend
  // voordeel", "Koopjesmarkt", "Voorraadkast", "Maaltijden…", "Bloemen…") return
  // null on purpose, so those items keep their name-based category.
  switch ((heading ?? "").replace(/\s+/g, " ").trim().toLowerCase()) {
    case "aardappelen, groente & fruit":
      return Category.GROENTE;
    case "vlees(waren), vis & vega":
    case "vlees, vis & vega":
      return Category.VLEES;
    case "brood, beleg & koek":
    case "brood, gebak & koek":
      return Category.BROOD_BANKET;
    case "zuivel & kaas":
    case "zuivel, kaas & eieren":
      return Category.ZUIVEL;
    case "kaas":
      return Category.KAAS;
    case "dranken, sap, koffie & thee":
    case "dranken":
      return Category.DRANKEN;
    case "bier, wijn & gedistilleerd":
    case "bier, wijn & sterke drank":
      return Category.ALCOHOL;
    case "diepvries":
      return Category.DIEPVRIES;
    case "kind & drogisterij":
    case "drogisterij & baby":
      return Category.DROGISTERIJ;
    case "huishoud & huisdieren":
    case "huishoud & dier":
      return Category.HUISHOUDEN;
    case "snacks & snoep":
    case "snoep, koek & chips":
      return Category.SNACKS_SNOEP;
    default:
      return null;
  }
}

/** Category for a card: a name keyword wins; else the section fallback; else OVERIG. */
export function categoryFor(
  name: string,
  addition: string | null,
  sectionCategory: Category | null,
): Category {
  const byName = categorize(name, [addition]);
  // HOUDBAAR and OVERIG are both "weak" name results: HOUDBAAR keywords are greedy
  // (e.g. "suiker" hits "suikermais", which is really GROENTE) and OVERIG means no
  // keyword at all — so a mapped section overrides either. A strong name keyword
  // (VIS, KAAS, …) always wins; with no mapped section we keep the weak result.
  if (byName !== Category.HOUDBAAR && byName !== Category.OVERIG) return byName;
  return sectionCategory ?? byName;
}

// --- Validity helpers (exported for testing) -------------------------------

// Dutch months keyed by their first three letters, so both the header's
// abbreviated "aug" and a packaging note's full "augustus" resolve the same.
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
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * Parse a Dutch "day month" date ("10 aug", "8 augustus") to a local Date at
 * midnight. The year is inferred; a date more than ~2 months in the past rolls to
 * next year (handles the Dec→Jan boundary), as the ad always shows a
 * current/near-future date.
 */
export function parseDutchDate(text: string | null, today = new Date()): Date | null {
  const m = text?.match(/(\d{1,2})\s+([a-zA-Z]+)/);
  if (!m) return null;
  const month = DUTCH_MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (month == null) return null;
  const day = Number(m[1]);
  let d = new Date(today.getFullYear(), month, day);
  if (d.getTime() < today.getTime() - 60 * 864e5) {
    d = new Date(today.getFullYear() + 1, month, day);
  }
  return d;
}

/**
 * DekaMarkt's weekly window from its end date: `validUntil` = end of that day,
 * `validFrom` = six days earlier (the ad runs a 7-day Tue→Mon cycle, so `end − 6`
 * is the start). The header's active button reads e.g. "t/m ma 10 aug".
 */
export function periodFromEndDate(endDate: Date): { validFrom: Date; validUntil: Date } {
  return { validFrom: dayStart(addDays(endDate, -6)), validUntil: dayEnd(endDate) };
}

/**
 * A per-card single-day override from the `.packaging` note, e.g.
 * "…Deze aanbieding is alleen geldig op zaterdag 8 augustus" → that day only.
 * Returns null when the note carries no such date (a plain "max. 2 per klant" or
 * an empty note), so the caller keeps the weekly window.
 */
export function parseSingleDayValidity(
  packaging: string | null,
  today: Date,
): { validFrom: Date; validUntil: Date } | null {
  if (!packaging) return null;
  const m = packaging.match(/alleen geldig op\s+\w+\s+(\d{1,2}\s+[a-zA-Z]+)/i);
  if (!m) return null;
  const day = parseDutchDate(m[1], today);
  return day ? { validFrom: dayStart(day), validUntil: dayEnd(day) } : null;
}

// --- Page parsing (exported for testing) -----------------------------------

/** Drop DekaMarkt's ?width= image resize hint for a canonical URL. */
function cleanImage(src: string | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, ORIGIN);
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Parse the DekaMarkt offers page (all department sections) into ScrapedOffers.
 * The weekly window comes from the header's active week button; a card whose
 * `.packaging` note pins it to a single day overrides that. Cards are deduped by
 * `data-product-id`.
 */
export function parseOffersPage(html: string, today = new Date()): ScrapedOffer[] {
  const $ = cheerio.load(html);

  // "t/m ma 10 aug" on the active week button → the current period's end date.
  const headerEnd = $("button.active").filter((_, b) => /t\/m/i.test($(b).text())).first().text();
  const endDate = parseDutchDate(headerEnd, today);
  const period = endDate
    ? periodFromEndDate(endDate)
    : { validFrom: dayStart(addDays(today, -6)), validUntil: dayEnd(addDays(today, 6)) };

  const byId = new Map<string, ScrapedOffer>();

  $("section.offers__department").each((_, sec) => {
    const section = $(sec);
    const heading = section.find("h3").first().text().replace(/\s+/g, " ").trim();
    const sectionCategory = mapDekaSectionCategory(heading);

    section.find("article.product__card[data-product-id]").each((__, node) => {
      const card = $(node);
      const id = card.attr("data-product-id") || "";

      const name = card.find("p.title").first().text().replace(/\s+/g, " ").trim();
      if (!name) return;

      const salePrice = parseDekaPrice(card.find(".prices__offer").first().text());
      if (salePrice == null || salePrice <= 0) return;

      const originalPrice = parseDekaPrice(card.find(".regular-strike").first().text() || null);
      const chip = card.find(".chip").first().text().replace(/\s+/g, " ").trim() || null;
      const addition = card.find(".addition").first().text().replace(/\s+/g, " ").trim() || null;
      const packaging = card.find(".packaging").first().text().replace(/\s+/g, " ").trim() || null;

      const norm = normalizePrice({ salePrice, originalPrice, offerText: chip });
      const { contentAmount, contentUnit } = parseDekaContent(addition);
      const singleDay = parseSingleDayValidity(packaging, today);
      const validity = singleDay ?? period;

      const offer: ScrapedOffer = {
        name,
        brand: null,
        category: categoryFor(name, addition, sectionCategory),
        subcategory: heading || null,
        imageUrl: cleanImage(card.find("img.image").first().attr("src")),
        deepLink: null, // DekaMarkt offer cards carry no per-product public URL.
        salePrice: norm.salePrice,
        originalPrice: norm.originalPrice,
        discountPercent: norm.discountPercent,
        offerText: norm.offerText,
        contentAmount,
        contentUnit,
        validFrom: validity.validFrom,
        validUntil: validity.validUntil,
      };

      // A handful of items are mirrored in "Extra weekend voordeel" and their real
      // department; keep the first seen (same price/label on both).
      const key = id || name;
      if (!byId.has(key)) byId.set(key, offer);
    });
  });

  return [...byId.values()];
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const today = new Date();
  const html = await httpText(OFFERS_URL);
  const offers = parseOffersPage(html, today);
  if (process.env.SCRAPE_DEBUG) console.error(`  [dekamarkt] ${offers.length} offers`);
  if (offers.length === 0) {
    throw new Error("No DekaMarkt offers found (page structure may have changed).");
  }
  return offers;
}

export const dekamarkt: Scraper = {
  slug: "dekamarkt",
  name: "DekaMarkt",
  logoUrl: "/logos/deka.png",
  scrape,
};
