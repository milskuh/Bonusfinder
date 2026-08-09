// src/scrapers/sources/dirk.ts
// Scraper for Dirk (formerly Dirk van den Broek), driven by the server-rendered
// offers page — the same plain-HTTP + cheerio approach as sources/hoogvliet.ts.
//
// dirk.nl is a Nuxt app, but the entire weekly ad is server-rendered as HTML
// offer cards, so we never touch the `__NUXT_DATA__` devalue blob: we fetch the
// page(s) and parse the DOM with cheerio. Two pages share the identical card
// markup and are both scraped:
//   https://www.dirk.nl/aanbiedingen  — the weekly groceries ad (grouped by dept)
//   https://www.dirk.nl/kanskoopjes   — non-food clearance ("kanskoopjes")
//
// robots.txt (verified 2026-07-30): `User-agent: * / Allow: /` — fully crawlable,
// no bot-challenge. We stay gentle regardless: sequential requests, a ~1.3s pause
// between pages, and a realistic desktop user-agent.
//
// THE price gotcha (see dirk.discovery.md): the sale price is split into a
// `price-large` + optional `price-small` span, and whether `price-large` is euros
// or *integer cents* is signalled by the `hasEuros` class — so a bare `49`
// (no `hasEuros`) is €0.49, not €49. Dirk exposes a real "van X.XX" was-price on
// many cards, so prices flow through the shared normalize.ts (one discount rule).
import * as cheerio from "cheerio";
import { Category } from "@prisma/client";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.dirk.nl";
const PAGES = ["/aanbiedingen", "/kanskoopjes"];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REQUEST_DELAY_MS = 1300; // polite pause between the two page requests.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Parse the leading run of digits from a string, or null if there are none. */
function digits(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\D+/g, "");
  return m.length ? parseInt(m, 10) : null;
}

/**
 * Sale price in euros from Dirk's split price spans. The euros/cents split is
 * signalled by the `hasEuros` class on `price-large`, NOT by a separator:
 *   hasEuros → `price-large` is euros, `price-small` is cents → euros + cents/100
 *              (the cents span may be absent for a whole-euro price → + 0)
 *   no hasEuros → `price-large` is the whole price in integer CENTS → value / 100
 * So `49` with no `hasEuros` is €0.49 (not €49) — the single most important
 * detail. Keying off the class (not "is there a cents span?") keeps a future
 * whole-euro price (hasEuros, no cents span) reading correctly too.
 */
export function parseSalePrice(
  hasEuros: boolean,
  largeText: string | null,
  smallText: string | null,
): number | null {
  const large = digits(largeText);
  if (large == null) return null;
  if (!hasEuros) return round2(large / 100);
  const cents = digits(smallText) ?? 0;
  return round2(large + cents / 100);
}

/** Original ("van X.XX") price in euros from the `regular-price` text, or null. */
export function parseOriginalPrice(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/\s+/g, " ").match(/van\s+(\d+[.,]\d{2})/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** True for the weekend-only "VR, ZA & ZO actie" label. */
export function isWeekendLabel(description: string | null): boolean {
  if (!description) return false;
  return /vr[\s,]+za\s*&?\s*zo/i.test(description);
}

/**
 * Parse Dirk's pack-size subtitle ("Zak 1 kilo.", "200 g", "24 x 300 ml") to a
 * base unit (kg / l / stuk). Ranges keep the last number ("300 of 400 gram" →
 * 0.4 kg); "Per stuk" and anything unparseable → null (best-effort, as elsewhere).
 */
export function parseDirkContent(text: string | null): {
  contentAmount: number | null;
  contentUnit: string | null;
} {
  if (!text) return { contentAmount: null, contentUnit: null };
  const s = text.toLowerCase().replace(",", ".");
  const unitRe = "(kilogram|kilo|kg|gram|gr|g|liter|litre|ml|cl|l|stuks|stuk)";
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
 * Map a Dirk department heading to our Category. Used only as a FALLBACK when the
 * product name yields no keyword (the AH pattern). The raw heading is never fed to
 * categorize() — headings like "Vlees, vis & vega" hold several category keywords
 * and would mis-fire. Sections with no clean mapping (Weekendverwenners,
 * Kanskoopjes…) return null → the item stays on its name-based category.
 */
export function mapDirkSectionCategory(heading: string | undefined): Category | null {
  switch ((heading ?? "").replace(/\s+/g, " ").trim()) {
    case "Aardappelen, groente & fruit":
      return Category.GROENTE;
    case "Vlees, vis & vega":
      return Category.VLEES;
    case "Brood, beleg & koek":
      return Category.BROOD_BANKET;
    case "Zuivel & kaas":
      return Category.ZUIVEL;
    case "Dranken, sap, koffie & thee":
      return Category.DRANKEN;
    case "Voorraadkast":
    case "Maaltijden, salades & tapas":
      return Category.HOUDBAAR;
    case "Diepvries":
      return Category.DIEPVRIES;
    case "Kind & drogisterij":
      return Category.DROGISTERIJ;
    case "Huishoud & huisdieren":
      return Category.HUISHOUDEN;
    case "Snacks & snoep":
      return Category.SNACKS_SNOEP;
    default:
      return null;
  }
}

/** Category for a card: a name keyword wins; else the section fallback; else OVERIG. */
export function categoryFor(
  name: string,
  subtitle: string | null,
  sectionCategory: Category | null,
): Category {
  const byName = categorize(name, [subtitle]);
  // HOUDBAAR and OVERIG are both "weak" name results: HOUDBAAR keywords are greedy
  // (e.g. "suiker" hits "suikermais", which is really GROENTE) and OVERIG means no
  // keyword at all — so a mapped section overrides either. A strong name keyword
  // (VIS, KAAS, …) always wins; with no mapped section we keep the weak result.
  if (byName !== Category.HOUDBAAR && byName !== Category.OVERIG) return byName;
  return sectionCategory ?? byName;
}

// --- Validity helpers (exported for testing) -------------------------------

const DUTCH_MONTHS: Record<string, number> = {
  januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
  juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
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
 * Parse a Dutch "day month" header date ("4 augustus") to a local Date at
 * midnight. The year is inferred; a date more than ~2 months in the past rolls
 * to next year (handles the Dec→Jan boundary), since the header always shows a
 * current/near-future period end.
 */
export function parseDutchDate(text: string | null, today = new Date()): Date | null {
  const m = text?.match(/(\d{1,2})\s+([a-zA-Z]+)/);
  if (!m) return null;
  const month = DUTCH_MONTHS[m[2].toLowerCase()];
  if (month == null) return null;
  const day = Number(m[1]);
  let d = new Date(today.getFullYear(), month, day);
  if (d.getTime() < today.getTime() - 60 * 864e5) {
    d = new Date(today.getFullYear() + 1, month, day);
  }
  return d;
}

/**
 * A Dirk period from its end date: `validUntil` = end of that day, `validFrom` =
 * six days earlier (both cycles — /aanbiedingen Wed→Tue and /kanskoopjes Sun→Sat
 * — are 7-day windows, so `end − 6` is the start).
 */
export function periodFromEndDate(endDate: Date): { validFrom: Date; validUntil: Date } {
  return { validFrom: dayStart(addDays(endDate, -6)), validUntil: dayEnd(endDate) };
}

/**
 * The Fri–Sun weekend inside a period, for "VR, ZA & ZO actie" offers: from the
 * Friday in [from, until] (00:00) through that Sunday (23:59:59). Falls back to
 * the full period if no Friday is found (shouldn't happen for a 7-day window).
 */
export function weekendWindow(from: Date, until: Date): { validFrom: Date; validUntil: Date } {
  let friday = dayStart(from);
  const end = dayEnd(until);
  while (friday <= end && friday.getDay() !== 5) friday = addDays(friday, 1);
  if (friday.getDay() !== 5) return { validFrom: dayStart(from), validUntil: dayEnd(until) };
  return { validFrom: dayStart(friday), validUntil: dayEnd(addDays(friday, 2)) };
}

// --- Page parsing (exported for testing) -----------------------------------

/**
 * Parse one Dirk offers page (all department sections) into ScrapedOffers.
 * Validity is read from the page header. Cards are deduped by product id; a few
 * items are mirrored in the "Weekendverwenners" section and their real category
 * section — when that happens we keep the mapped-category occurrence so the
 * category/subcategory are the specific ones (the weekend label, and thus the
 * weekend validity, is present on both).
 */
export function parseOffersPage(html: string, today = new Date()): ScrapedOffer[] {
  const $ = cheerio.load(html);

  const headerDate = $(".calender-button.current .date").first().text().trim();
  const endDate = parseDutchDate(headerDate, today);
  const period = endDate
    ? periodFromEndDate(endDate)
    : { validFrom: dayStart(today), validUntil: dayEnd(addDays(today, 6)) };

  const byId = new Map<string, { offer: ScrapedOffer; mapped: boolean }>();

  $("section.department").each((_, sec) => {
    const section = $(sec);
    const heading = section.find("h2").first().text().replace(/\s+/g, " ").trim();
    const sectionCategory = mapDirkSectionCategory(heading);
    const mapped = sectionCategory != null;

    section.find("article[data-product-id]").each((__, node) => {
      const art = $(node);

      const name = art.find("p.title").first().text().replace(/\s+/g, " ").trim();
      if (!name) return;

      const largeEl = art.find(".price-large").first();
      if (largeEl.length === 0) return;
      const hasEuros = (largeEl.attr("class") ?? "").includes("hasEuros");
      const smallText = art.find(".price-small").first().text().trim() || null;
      const salePrice = parseSalePrice(hasEuros, largeEl.text().trim(), smallText);
      if (salePrice == null || salePrice <= 0) return;

      const description = art.find(".price-label .description").first().text().replace(/\s+/g, " ").trim() || null;
      const weekend = isWeekendLabel(description);
      const originalPrice = parseOriginalPrice(art.find(".regular-price").first().text() || null);

      const subtitle = art.find("span.subtitle").first().text().replace(/\s+/g, " ").trim() || null;
      const opOp =
        art.find(".logos img").toArray().some((img) => /op\s*=\s*op/i.test($(img).attr("alt") ?? "")) ||
        /op\s*=\s*op/i.test(subtitle ?? "");

      const flags: string[] = [];
      if (weekend) flags.push("VR, ZA & ZO actie");
      if (opOp) flags.push("Op=Op");
      const offerTextIn = flags.length ? flags.join(", ") : null;

      const norm = normalizePrice({ salePrice, originalPrice, offerText: offerTextIn });
      const { contentAmount, contentUnit } = parseDirkContent(subtitle);

      const rawImg = art.find("img.main-image").first().attr("src") || null;
      let imageUrl: string | null = null;
      if (rawImg) {
        const u = new URL(rawImg, ORIGIN);
        u.search = ""; // drop the ?width= resize hint for a canonical URL
        imageUrl = u.toString();
      }

      const href = art.find('a[href^="/boodschappen"]').first().attr("href") || null;
      const deepLink = href ? new URL(href, ORIGIN).toString() : null;

      const validity = weekend ? weekendWindow(period.validFrom, period.validUntil) : period;

      const offer: ScrapedOffer = {
        name,
        brand: null,
        category: categoryFor(name, subtitle, sectionCategory),
        subcategory: heading || null,
        imageUrl,
        deepLink,
        salePrice: norm.salePrice,
        originalPrice: norm.originalPrice,
        discountPercent: norm.discountPercent,
        offerText: norm.offerText,
        contentAmount,
        contentUnit,
        validFrom: validity.validFrom,
        validUntil: validity.validUntil,
      };

      const id = art.attr("data-product-id") || name;
      const prev = byId.get(id);
      if (!prev || (!prev.mapped && mapped)) byId.set(id, { offer, mapped });
    });
  });

  return [...byId.values()].map((v) => v.offer);
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const today = new Date();
  const byId = new Map<string, ScrapedOffer>();

  let first = true;
  for (const path of PAGES) {
    if (!first) await sleep(REQUEST_DELAY_MS);
    first = false;
    try {
      const html = await httpText(`${ORIGIN}${path}`);
      const offers = parseOffersPage(html, today);
      if (process.env.SCRAPE_DEBUG) console.error(`  [dirk] ${path}: ${offers.length} offers`);
      for (const offer of offers) {
        const key = offer.deepLink ?? offer.name;
        if (!byId.has(key)) byId.set(key, offer);
      }
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [dirk] ${path}: ${(err as Error).message}`);
    }
  }

  const offers = [...byId.values()];
  if (process.env.SCRAPE_DEBUG) console.error(`  [dirk] ${offers.length} offers total`);
  if (offers.length === 0) {
    throw new Error("No Dirk offers found (page structure may have changed).");
  }
  return offers;
}

export const dirk: Scraper = {
  slug: "dirk",
  name: "Dirk",
  logoUrl: "https://logo.clearbit.com/dirk.nl",
  scrape,
};
