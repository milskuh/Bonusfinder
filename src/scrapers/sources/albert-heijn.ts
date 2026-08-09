// src/scrapers/sources/albert-heijn.ts
// Scraper for Albert Heijn's weekly "Bonus" offers.
//
// AH's website (ah.nl/bonus) renders the offers from its public mobile API at
// api.ah.nl — a clean JSON source (the same one the AH app uses), so we use that
// directly rather than scraping the Akamai-protected website HTML.
//
//   1. POST /mobile-auth/v1/auth/token/anonymous  → anonymous bearer token
//   2. GET  /mobile-services/bonuspage/v3/metadata → current period + a list of
//      category "sections" (Vlees, Kaas, Frisdrank, …), each with a section URL
//   3. GET  each section → `bonusGroup`s (the deal cards shown on the bonus page)
//
// Each bonusGroup is a promotion ("Alle Beemster 25% korting", "2 voor 4.99",
// "1+1 gratis"). AH is promotion-centric: a fixed-price / X-for-Y deal carries a
// euro price, but a percentage or 1+1 deal has none — hence salePrice is
// optional. Discount data comes structured in `discountLabels`.
//
// NEXT week: AH exposes only the current period, and gates the next one behind a
// `nextPeriodVisibleFrom` date (a Friday). Until then next week is unreachable
// (the `date=` param returns nothing), so the "next week" feed is simply empty
// for AH until ~Friday, then fetchUpcomingOffers() picks it up. No placeholders.
//
// robots.txt: api.ah.nl is the app API (not the Disallowed www.ah.nl/data paths)
// and /bonus itself is crawlable. We stay gentle: sequential, a short delay and
// a realistic app user-agent.
import { Category } from "@prisma/client";
import { categorize } from "../categorize";
import type { ScrapedOffer, Scraper } from "../types";

const API = "https://api.ah.nl";
const USER_AGENT = "Appie/8.22.3 Model/phone Android/13";
const APPLICATION = "AHWEBSHOP";
const REQUEST_DELAY_MS = 800; // the API is fast; a short courtesy pause.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- API client -------------------------------------------------------------

async function anonymousToken(): Promise<string> {
  const res = await fetch(`${API}/mobile-auth/v1/auth/token/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ clientId: "appie" }),
  });
  if (!res.ok) throw new Error(`AH auth failed → ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("AH auth returned no access_token");
  return json.access_token;
}

async function apiJson<T>(path: string, token: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}/mobile-services/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "x-application": APPLICATION,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Types mirroring the parts of the API response we use ------------------

interface DiscountLabel {
  code?: string;
  price?: number | null;
  percentage?: number | null;
}
interface BonusGroup {
  offerId?: number;
  segmentId?: number;
  segmentDescription?: string;
  discountDescription?: string;
  category?: string;
  discountLabels?: DiscountLabel[];
  images?: { width: number; url: string }[];
  validityPeriod?: { start?: string; end?: string };
  bonusStartDate?: string;
  bonusEndDate?: string;
}
interface BonusSection {
  bonusGroupOrProducts?: { bonusGroup?: BonusGroup }[];
}
interface UrlMeta { url: string; bonusType?: string }
interface Period {
  bonusStartDate?: string;
  bonusEndDate?: string;
  /** Date (a Friday) from which AH exposes the NEXT period. Empty until then. */
  nextPeriodVisibleFrom?: string;
  tabs?: { description?: string; urlMetadataList?: UrlMeta[] }[];
}
interface Metadata {
  periods?: Period[];
}

// --- Pure mapping (exported for testing) -----------------------------------

/**
 * Map AH's own bonus-section name to our Category. Used as a fallback: AH deal
 * titles are often just "Alle <brand>" with no category keyword, so the section
 * AH filed the deal under is the most reliable signal when the name yields
 * nothing. A strong keyword in the name still wins (see parseBonusGroup).
 */
function mapSectionCategory(section: string | undefined): Category | null {
  switch (section) {
    case "Groente, aardappelen": return Category.GROENTE;
    case "Fruit, verse sappen": return Category.FRUIT;
    case "Vlees":
    case "Vleeswaren": return Category.VLEES;
    case "Vis": return Category.VIS;
    case "Kaas": return Category.KAAS;
    case "Zuivel, eieren": return Category.ZUIVEL;
    case "Bakkerij": return Category.BROOD_BANKET;
    case "Pasta, rijst, wereldkeuken": return Category.PASTA_RIJST;
    case "Borrel, chips, snacks":
    case "Koek, snoep, chocolade":
    case "Tussendoortjes": return Category.SNACKS_SNOEP;
    case "Ontbijtgranen, beleg": return Category.ONTBIJT;
    case "Diepvries": return Category.DIEPVRIES;
    case "Koffie, thee":
    case "Frisdrank, sappen, water": return Category.DRANKEN;
    case "Bier, wijn, aperitieven": return Category.ALCOHOL;
    case "Drogisterij": return Category.DROGISTERIJ;
    case "Huishouden": return Category.HUISHOUDEN;
    case "Baby en kind": return Category.BABY_KIND;
    case "Huisdier": return Category.HUISDIER;
    default: return null;
  }
}

/** Parse a date-only string ("2026-08-02") as an end-of-day / start-of-day Date. */
function asDate(s: string | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Map one AH bonusGroup to a ScrapedOffer. Returns null if it lacks a name.
 *
 * Price/discount come from `discountLabels`:
 *   DISCOUNT_FIXED_PRICE / DISCOUNT_X_FOR_Y → `price` is the (bundle) sale price
 *   DISCOUNT_PERCENTAGE                      → `percentage` is the discount
 *   DISCOUNT_X_PLUS_Y_FREE / BONUS           → neither (offerText only)
 */
export function parseBonusGroup(g: BonusGroup, today = new Date()): ScrapedOffer | null {
  const name = g.segmentDescription?.trim();
  if (!name) return null;

  const label = g.discountLabels?.[0] ?? {};
  const salePrice = typeof label.price === "number" ? label.price : null;
  const discountPercent =
    label.code === "DISCOUNT_PERCENTAGE" && typeof label.percentage === "number"
      ? label.percentage
      : null;

  // Prefer a mid-size image (708px is the largest AH serves for these).
  const image = [...(g.images ?? [])].sort((a, b) => b.width - a.width)[0]?.url ?? null;

  const validFrom = asDate(g.validityPeriod?.start ?? g.bonusStartDate) ?? today;
  const validUntil =
    asDate(g.validityPeriod?.end ?? g.bonusEndDate, true) ?? new Date(today.getTime() + 7 * 864e5);

  // A strong name keyword wins (e.g. "cola" → SODA). A weak result — HOUDBAAR
  // (greedy pantry keywords) or OVERIG (no keyword) — defers to the section AH
  // filed the deal under; with no mapped section we keep the weak result.
  const byName = categorize(name);
  const category =
    byName !== Category.HOUDBAAR && byName !== Category.OVERIG
      ? byName
      : mapSectionCategory(g.category) ?? byName;

  return {
    name,
    brand: null,
    category,
    subcategory: g.category ?? null,
    imageUrl: image,
    deepLink: null, // AH bonus groups have no stable per-deal public URL.
    salePrice,
    originalPrice: null, // AH doesn't expose a "was" price at the group level.
    discountPercent,
    offerText: g.discountDescription?.trim() || null,
    contentAmount: null,
    contentUnit: null,
    validFrom,
    validUntil,
  };
}

// --- Orchestration ----------------------------------------------------------

/** Section types that are Albert Heijn's own supermarket offers (not Gall/Etos). */
const KEEP_BONUS_TYPES = new Set(["NATIONAL", "AHONLINE"]);

/** The "Alle Bonus" tab's sections that are AH's own (drop Gall/Etos + SPOTLIGHT). */
function nationalSections(meta: Metadata): UrlMeta[] {
  const tab =
    meta.periods?.[0]?.tabs?.find((t) => /alle bonus/i.test(t.description ?? "")) ??
    meta.periods?.[0]?.tabs?.[0];
  return (tab?.urlMetadataList ?? []).filter(
    (s) => s.bonusType && KEEP_BONUS_TYPES.has(s.bonusType),
  );
}

/** Fetch + parse every bonusGroup across the given sections, deduped by offer key. */
async function fetchSectionOffers(
  sections: UrlMeta[],
  token: string,
): Promise<Map<string, ScrapedOffer>> {
  const byKey = new Map<string, ScrapedOffer>();
  let first = true;
  for (const section of sections) {
    if (!first) await sleep(REQUEST_DELAY_MS);
    first = false;
    try {
      const data = await apiJson<BonusSection>(section.url, token);
      for (const entry of data.bonusGroupOrProducts ?? []) {
        const group = entry.bonusGroup;
        if (!group) continue;
        const key = String(group.offerId ?? group.segmentId ?? group.segmentDescription);
        if (byKey.has(key)) continue;
        const offer = parseBonusGroup(group);
        if (offer) byKey.set(key, offer);
      }
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [ah] section ${section.url}: ${(err as Error).message}`);
    }
  }
  return byKey;
}

/** Format a Date as a local YYYY-MM-DD (the shape AH's `date=` param expects). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Swap (or append) the `date=` query param on a section URL. */
function withDate(url: string, date: string): string {
  return /date=\d{4}-\d{2}-\d{2}/.test(url)
    ? url.replace(/date=\d{4}-\d{2}-\d{2}/, `date=${date}`)
    : `${url}${url.includes("?") ? "&" : "?"}date=${date}`;
}

/**
 * Best-effort fetch of NEXT week's bonus, when AH exposes it. AH shows only one
 * period at a time and gates the next behind `nextPeriodVisibleFrom` (a Friday);
 * before then the `date=` param returns nothing, so we don't even try. Once it's
 * visible we re-read metadata for a next-week date and pull its sections, forcing
 * `date=` onto each section URL. Everything is filtered to genuinely future-dated
 * offers (validFrom after the current period ends), so nothing here can duplicate
 * or misdate the current week. Empty until rollover is expected — never faked.
 */
async function fetchUpcomingOffers(
  meta: Metadata,
  token: string,
  now: Date,
  current: Map<string, ScrapedOffer>,
): Promise<ScrapedOffer[]> {
  const period = meta.periods?.[0];
  const visibleFrom = asDate(period?.nextPeriodVisibleFrom);
  const currentEnd = asDate(period?.bonusEndDate, true);
  if (!visibleFrom || !currentEnd || now < visibleFrom) return [];

  const nextDate = ymd(new Date(currentEnd.getTime() + 12 * 3600_000)); // day after current end
  try {
    await sleep(REQUEST_DELAY_MS);
    const nextMeta = await apiJson<Metadata>(`bonuspage/v3/metadata?date=${nextDate}`, token);
    const sections = nationalSections(nextMeta).map((s) => ({ ...s, url: withDate(s.url, nextDate) }));
    await sleep(REQUEST_DELAY_MS);
    const fetched = await fetchSectionOffers(sections, token);
    const upcoming: ScrapedOffer[] = [];
    for (const [key, offer] of fetched) {
      if (offer.validFrom > currentEnd && !current.has(key)) upcoming.push(offer);
    }
    return upcoming;
  } catch (err) {
    if (process.env.SCRAPE_DEBUG) console.error(`  [ah] upcoming fetch failed: ${(err as Error).message}`);
    return [];
  }
}

async function scrape(): Promise<ScrapedOffer[]> {
  const now = new Date();
  const token = await anonymousToken();
  const meta = await apiJson<Metadata>("bonuspage/v3/metadata", token);

  const current = await fetchSectionOffers(nationalSections(meta), token);
  if (process.env.SCRAPE_DEBUG) console.error(`  [ah] ${current.size} current bonus deals`);

  const upcoming = await fetchUpcomingOffers(meta, token, now, current);
  if (process.env.SCRAPE_DEBUG) console.error(`  [ah] ${upcoming.length} upcoming bonus deals`);

  const offers = [...current.values(), ...upcoming];
  if (offers.length === 0) throw new Error("No Albert Heijn bonus deals found (API may have changed).");
  return offers;
}

export const albertHeijn: Scraper = {
  slug: "ah",
  name: "Albert Heijn",
  logoUrl: "https://logo.clearbit.com/ah.nl",
  scrape,
};
