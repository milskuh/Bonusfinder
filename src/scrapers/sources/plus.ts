// src/scrapers/sources/plus.ts
// Scraper for PLUS (the franchise supermarket), driven by the webshop's own
// promotions API — the same "read the app's internal JSON endpoint" approach as
// sources/albert-heijn.ts, but against a PLUS OutSystems back end.
//
// plus.nl/aanbiedingen is a client-rendered OutSystems Reactive app. Its promo
// grid is populated by ONE server DataAction:
//   POST /screenservices/ECP_Composition_CW/Promotions/
//        Promotion_LP_Content_TF_OptimizationECOP9566/DataActionGetPromotionList_Optimization
// which returns every promo category with its offers (see plus.discovery.md). We
// call it directly with plain fetch — no headless browser — after a small bootstrap
// to satisfy the platform's anti-CSRF + version checks:
//   1. GET /aanbiedingen                      → Imperva/Incapsula session cookies
//   2. GET /moduleservices/moduleversioninfo  → the module version token
//   3. GET the DataAction's .mvc.js           → the action's api version token
//   4. a throwaway POST (no token)            → 403, but sets the `nr2Users` cookie
//      whose `crf=` field is the X-CSRFToken we echo on the real call
// All four rotate (versions per deploy, CSRF per session), so nothing is hardcoded
// except the stable endpoint paths and the (rarely-changing) request body template.
//
// Validity: PLUS promo weeks run Wednesday→Tuesday; each offer carries its own
// StartDate/EndDate, so we use those directly. The API also exposes NEXT week
// (IsNextWeekPublished + PromotionPeriodId 2), which we pull so the app's "next
// week" toggle fills ahead of rollover — never faked; empty until PLUS publishes it.
//
// Franchise scoping: PLUS stores are independently operated, but the webshop's
// national default (StoreNumber 0) is exactly the "one national feed" this app
// models, so we use it and don't attempt per-store pricing (see plus.discovery.md).
//
// Prices: NewPrice is the sale price; PriceOriginal_Lowest is the pre-discount
// "from" price. Multi-buy mechanics ("1+1 GRATIS", "3 VOOR 5.00", "2E HALVE PRIJS")
// come as a DisplayInfo_Label and go into offerText; normalize.ts then suppresses
// any synthetic percentage for them, exactly like AH.
import { Category } from "@prisma/client";
import { categorize } from "../categorize";
import { normalizePrice } from "../normalize";
import type { ScrapedOffer, Scraper } from "../types";

const ORIGIN = "https://www.plus.nl";
const DATA_ACTION =
  "/screenservices/ECP_Composition_CW/Promotions/Promotion_LP_Content_TF_OptimizationECOP9566/DataActionGetPromotionList_Optimization";
const MVC_JS =
  "/scripts/ECP_Composition_CW.Promotions.Promotion_LP_Content_TF_OptimizationECOP9566.mvc.js";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// --- Types mirroring the parts of the response we use ----------------------

/** One offer inside a category (the bulk of the feed). */
export interface PlusOffer {
  PromotionID?: string;
  Offer_Id?: string;
  Brand?: string;
  Name?: string;
  Variant?: string;
  Package?: string;
  Slug?: string;
  ImageURL?: string;
  NewPrice?: string;
  PriceOriginal_Lowest?: string;
  PriceOriginal_Highest?: string;
  DisplayInfo_Label?: string;
  StartDate?: string;
  EndDate?: string;
  IsFreeDeliveryOffer?: boolean;
  IsProductOverMajorityAge?: boolean;
  Product_IsNIX18?: boolean;
}

/** A featured "tile" on a banner (some are banner-only, not in any category). */
export interface PlusTile {
  PromotionId?: string;
  OfferId?: string;
  Brand?: string;
  ProductName?: string;
  PromotionLabel?: string;
  Subtitle?: string;
  Slug?: string;
  ImageURL?: string;
  NewPrice?: string;
  PriceOriginal_Lowest?: string;
  PriceOriginal_Highest?: string;
  DisplayInfo_Label?: string;
  StartDate?: string;
  EndDate?: string;
  IsFreeDeliveryOffer?: boolean;
  IsProductOverMajorityAge?: boolean;
  PromotionVariant?: string;
  PromotionPackage?: string;
}

interface PlusBanner {
  Category?: {
    CategoryLabel?: string;
    Offers?: { List?: PlusOffer[] };
  };
  ProductPromotionTiles?: { List?: PlusTile[] };
}

export interface PlusResponse {
  data?: {
    PromotionOfferList?: { List?: PlusBanner[] };
    IsNextWeekPublished?: boolean;
  };
}

// --- Pure mapping helpers (exported for testing) ---------------------------

/**
 * Map a PLUS category-grid label to our Category. Used only as a FALLBACK when the
 * product name yields no keyword (the AH/Dirk pattern) — the label groups several
 * of our categories ("Vlees, kip, vis, vega"), so a name keyword wins first. The
 * "Wijn, bier, sterke drank" aisle backstops alcohol whose name is only a brand.
 * Non-food/mixed aisles return null so the name (then OVERIG) decides.
 */
export function mapPlusCategory(label: string | undefined): Category | null {
  switch ((label ?? "").trim()) {
    case "Aardappelen, groente, fruit": return Category.GROENTE;
    case "Vlees, kip, vis, vega": return Category.VLEES;
    case "Kaas, vleeswaren, tapas": return Category.KAAS;
    case "Zuivel, eieren, boter": return Category.ZUIVEL;
    case "Brood, gebak, bakproducten": return Category.BROOD_BANKET;
    case "Ontbijtgranen, broodbeleg, tussendoor": return Category.ONTBIJT;
    case "Frisdrank, sappen, koffie, thee": return Category.DRANKEN;
    case "Wijn, bier, sterke drank": return Category.ALCOHOL;
    case "Pasta, rijst, internationale keuken": return Category.PASTA_RIJST;
    case "Soepen, conserven, sauzen, smaakmakers":
    case "Verse kant-en-klaarmaaltijden": return Category.HOUDBAAR;
    case "Snoep, koek, chocolade, chips, noten": return Category.SNACKS_SNOEP;
    case "Diepvries": return Category.DIEPVRIES;
    case "Baby, drogisterij": return Category.DROGISTERIJ;
    case "Huishouden": return Category.HUISHOUDEN;
    case "Huisdier": return Category.HUISDIER;
    default: return null; // "Wonen, bloemen, service", "Gratis bezorging", …
  }
}

/** A euro amount from a PLUS price string ("2.49", "0.0", ""), or null. */
function money(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/**
 * Keep a DisplayInfo_Label as offerText only when it states a multi-buy MECHANIC
 * ("1+1 GRATIS", "3 VOOR 5.00", "2E HALVE PRIJS", "3+1 GRATIS") — the kind of deal
 * a straight percentage can't express and that normalize.ts must not turn into a
 * synthetic discount. Plain "% KORTING", "€ KORTING" and "500 GRAM 1.19" price
 * labels are dropped: their saving is already carried by salePrice/originalPrice.
 */
export function plusOfferText(label: string | undefined): string | null {
  const s = (label ?? "").trim();
  if (!s) return null;
  return /gratis|voor|halve|\+/i.test(s) ? s : null;
}

/** validFrom (start of StartDate) / validUntil (end of EndDate), local time. */
export function plusValidity(
  startDate: string | undefined,
  endDate: string | undefined,
  today = new Date(),
): { validFrom: Date; validUntil: Date } {
  const from = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const until = endDate ? new Date(`${endDate}T23:59:59`) : null;
  return {
    validFrom: from && !isNaN(from.getTime()) ? from : today,
    validUntil:
      until && !isNaN(until.getTime()) ? until : new Date(today.getTime() + 7 * 864e5),
  };
}

// Unit spellings, longest-first so "gram" wins over "g"; a trailing \b avoids
// matching the "g" inside a word. Shared by the label and variant size regexes.
const CONTENT_UNIT = "(kilogram|kilo|kg|gram|gr|liter|litre|ml|cl|l|g)";

function toBaseSize(value: number, unit: string): { contentAmount: number; contentUnit: string } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (unit.toLowerCase()) {
    case "kilogram": case "kilo": case "kg": return { contentAmount: value, contentUnit: "kg" };
    case "gram": case "gr": case "g": return { contentAmount: round3(value / 1000), contentUnit: "kg" };
    case "liter": case "litre": case "l": return { contentAmount: value, contentUnit: "l" };
    case "ml": return { contentAmount: round3(value / 1000), contentUnit: "l" };
    case "cl": return { contentAmount: round3(value / 100), contentUnit: "l" };
    default: return null;
  }
}

/**
 * Best-effort pack size from a PLUS "price form" label ("500 GRAM 1.19") or a
 * simple `variant` ("Schaal 500 gram"). Deliberately conservative: a variant that
 * is a range ("500-1000 gram"), a multipack ("12 x 33 cl") or a per-item "à N unit"
 * descriptor is left null, because a guessed size would mislead the per-unit price.
 * Normalised to kg / l like the other sources.
 */
export function parsePlusContent(
  label: string | undefined,
  variant: string | undefined,
): { contentAmount: number | null; contentUnit: string | null } {
  const none = { contentAmount: null, contentUnit: null };

  // 1. The label's leading "N UNIT price" form is unambiguous.
  const fromLabel = (label ?? "").match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${CONTENT_UNIT}\\b`, "i"));
  if (fromLabel) return toBaseSize(parseFloat(fromLabel[1].replace(",", ".")), fromLabel[2]) ?? none;

  // 2. The variant, only when it names exactly ONE size and isn't a range / multipack
  //    / per-item ("à") descriptor — otherwise the size is not the product's own.
  const v = (variant ?? "").toLowerCase();
  if (!v || /à|[×x]\s*\d|\d\s*[-–]\s*\d/.test(v)) return none;
  const sizes = [...v.matchAll(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${CONTENT_UNIT}\\b`, "gi"))];
  if (sizes.length !== 1) return none;
  return toBaseSize(parseFloat(sizes[0][1].replace(",", ".")), sizes[0][2]) ?? none;
}

/** Absolute https image URL from PLUS's (often protocol-relative) ImageURL. */
function imageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  return /^https?:\/\//.test(raw) ? raw : null;
}

/**
 * Build one ScrapedOffer from the fields common to a category offer and a tile.
 * Returns null when there's no usable name or it's a free-delivery promo (those
 * carry no product price and aren't shopping deals). Category is name-first with
 * the PLUS aisle label as the fallback; multi-buy mechanics ride in offerText.
 */
function toOffer(o: {
  brand?: string;
  name?: string;
  slug?: string;
  image?: string;
  newPrice?: string;
  lowest?: string;
  label?: string;
  variant?: string;
  categoryLabel?: string;
  isFreeDelivery?: boolean;
  startDate?: string;
  endDate?: string;
  today: Date;
}): ScrapedOffer | null {
  if (o.isFreeDelivery) return null;

  const core = (o.name ?? "").replace(/\s+/g, " ").trim();
  const brand = (o.brand ?? "").replace(/\s+/g, " ").trim();
  const name = core && brand ? `${brand} ${core}` : core || brand;
  if (!name) return null;

  const sale = money(o.newPrice);
  const originalIn = money(o.lowest);
  const offerTextIn = plusOfferText(o.label);
  // Only feed an original that is genuinely above the sale (a real "was" price).
  const original = sale != null && originalIn != null && originalIn > sale ? originalIn : null;

  const price =
    sale != null
      ? normalizePrice({ salePrice: sale, originalPrice: original, offerText: offerTextIn })
      : { salePrice: null, originalPrice: null, discountPercent: null, offerText: offerTextIn };

  // Classify by NAME ONLY (the brand is already part of `name`). The PLUS aisle
  // label is NEVER a categorize() hint: labels like "Kaas, vleeswaren, tapas" hold
  // several category keywords ("vlees" inside "vleeswaren"), which would mis-route
  // every cheese/tapas item to VLEES. The label is used only as the fallback below,
  // via the disambiguated mapPlusCategory(). (Same trap as the Dirk/AH section maps.)
  const byName = categorize(name);
  const category =
    byName !== Category.HOUDBAAR && byName !== Category.OVERIG
      ? byName
      : mapPlusCategory(o.categoryLabel) ?? byName;

  const { contentAmount, contentUnit } = parsePlusContent(o.label, o.variant);
  const { validFrom, validUntil } = plusValidity(o.startDate, o.endDate, o.today);

  return {
    name,
    brand: null, // PLUS "Brand" is often a promo grouping ("Alle Knorr") → fold into name, like AH.
    category,
    subcategory: o.categoryLabel ?? null,
    imageUrl: imageUrl(o.image),
    deepLink: o.slug ? `${ORIGIN}/aanbiedingen/${o.slug}` : null,
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

/** Map one category offer to a ScrapedOffer (or null). */
export function parsePlusOffer(
  o: PlusOffer,
  categoryLabel: string | undefined,
  today = new Date(),
): ScrapedOffer | null {
  return toOffer({
    brand: o.Brand, name: o.Name, slug: o.Slug, image: o.ImageURL,
    newPrice: o.NewPrice, lowest: o.PriceOriginal_Lowest, label: o.DisplayInfo_Label,
    variant: o.Variant, categoryLabel, isFreeDelivery: o.IsFreeDeliveryOffer,
    startDate: o.StartDate, endDate: o.EndDate, today,
  });
}

/** Map one banner tile to a ScrapedOffer (or null). */
export function parsePlusTile(t: PlusTile, today = new Date()): ScrapedOffer | null {
  return toOffer({
    brand: t.Brand, name: t.ProductName || t.PromotionLabel || t.Subtitle, slug: t.Slug,
    image: t.ImageURL, newPrice: t.NewPrice, lowest: t.PriceOriginal_Lowest,
    label: t.DisplayInfo_Label, variant: t.PromotionVariant,
    categoryLabel: undefined, isFreeDelivery: t.IsFreeDeliveryOffer,
    startDate: t.StartDate, endDate: t.EndDate, today,
  });
}

/**
 * Turn one promotions-API response into ScrapedOffers. Walks every banner's
 * category offers and featured tiles, skips the "Gratis bezorging" (free-delivery)
 * section, and dedupes by Slug within its validity window so a tile that also
 * appears in a category isn't counted twice.
 */
export function parsePlusResponse(json: PlusResponse, today = new Date()): ScrapedOffer[] {
  const banners = json.data?.PromotionOfferList?.List ?? [];
  const byKey = new Map<string, ScrapedOffer>();
  const add = (offer: ScrapedOffer | null, slug: string | undefined) => {
    if (!offer) return;
    const key = `${slug ?? offer.name}|${offer.validFrom.getTime()}`;
    if (!byKey.has(key)) byKey.set(key, offer);
  };

  for (const banner of banners) {
    const label = banner.Category?.CategoryLabel;
    if (label === "Gratis bezorging") continue; // free-delivery thresholds, not products
    for (const o of banner.Category?.Offers?.List ?? []) add(parsePlusOffer(o, label, today), o.Slug);
    for (const t of banner.ProductPromotionTiles?.List ?? []) add(parsePlusTile(t, today), t.Slug);
  }
  return [...byKey.values()];
}

// --- Bootstrap + network (impure) ------------------------------------------

/** The proven-good request-body template; only versionInfo + period are overridden. */
const SCREEN_TEMPLATE =
  '{"versionInfo":{"moduleVersion":"","apiVersion":""},"viewName":"MainFlow.Promotions","screenData":{"variables":{"IsShowData":false,"IsPreloadedHTMLActive":false,"StoreNumber":0,"StoreChannel":"","PromotionPeriodId":1,"LocalPromotionList":{"List":[],"EmptyListItem":{"ProductPromotionBanner":{"InternalTitle":"","Subtitle":"","Title":"","AnchorLinkTitle":"","Cta":{"InternalTitle":"","Link":{"Title":"","Url":"","AltText":"","IsPdf":false}},"BackgroundColorClassName":"","BannerImageNoProducts":{"Url":"","AltText":""},"BannerImageWithProducts":{"Url":"","AltText":""},"Productspromotions":{"List":[],"EmptyListItem":""},"ProductPromotionTiles":{"List":[],"EmptyListItem":{"PromotionId":"","OfferId":"","ProductName":"","PromotionLabel":"","PromotionBasedLabel":"","Subtitle":"","Brand":"","Slug":"","DisplayInfo_Label":"","DisplayInfo_PromotionBasedLabel":"","NewPrice":"0","PriceOriginal":"0","PriceOriginal_Highest":"0","PriceOriginal_Lowest":"0","StartDate":"1900-01-01","EndDate":"1900-01-01","ImageURL":"","ImageLabel":"","Position":0,"IsProduct":false,"IsFreeDeliveryOffer":false,"IsSingleProductPromotion":false,"BadgeQuantity":0,"Logos":{"PLPInUpperLeft":{"List":[],"EmptyListItem":{"Name":"","LongDescription":"","URL":"","Order":0}},"PLPAboveTitle":{"List":[],"EmptyListItem":{"Name":"","LongDescription":"","URL":"","Order":0}},"PLPBehindSizeUnit":{"List":[],"EmptyListItem":{"Name":"","LongDescription":"","URL":"","Order":0}}},"IsProductOverMajorityAge":false,"Categories":{"List":[],"EmptyListItem":{"Name":""}},"PromotionVariant":"","PromotionPackage":"","PromotionExplanation":"","ProductSKU":"","ProductLineItemId":"","StampURL":"","MaxOrderLimit":0}},"IsUnderAge":false,"ClickDelayValue":0,"ProductCategories":"","PromotionCategories":"","Priority":0,"UpdatedAt":"1900-01-01T00:00:00","ProductCategoriesList":{"List":[],"EmptyListItem":""},"PromotionCategoriesList":{"List":[],"EmptyListItem":""},"PlacementId":""},"Category":{"CategoryId":"","CategoryLabel":"","CategorySortOrder":"0","Offers":{"List":[],"EmptyListItem":{"PromotionID":"","Offer_Id":"","PromotionSortOrder":"0","Brand":"","Name":"","Example":"","Variant":"","Explanation":"","Package":"","Slug":"","ImageURL":"","ImageLabel":"","MetaTitle":"","MetaDescription":"","NewPrice":"0","PriceOriginal_Product":"0","PriceOriginal_Highest":"0","PriceOriginal_Lowest":"0","IsOfflineSaleOnly":false,"IsProductOverMajorityAge":false,"DisplayInfo_Label":"","DisplayInfo_PromotionBasedLabel":"","StartDate":"1900-01-01","EndDate":"1900-01-01","IsFreeDeliveryOffer":false,"IsSingleProduct":false,"Product_SKU":"","Product_LineItemId":"","Product_Quantity":0,"ProductLoyaltyInfoID":0,"Product_IsNIX18":false,"Product_MaxOrderLimit":0,"StampURL":"","StoreNumberList":{"List":[],"EmptyListItem":""}}},"SKUsAvailable":{"List":[],"EmptyListItem":""},"NumberOfProducts":0}}},"ItemExistsInCart":{"List":[],"EmptyListItem":{"LineItemId":"","SKU":"","Quantity":0}},"IsAppedingRecords":false,"StartIndex":0,"MaxRecords":1,"IsDesktop":true,"_isDesktopInDataFetchStatus":1,"IsTablet":false,"_isTabletInDataFetchStatus":1,"IsPhone":false,"_isPhoneInDataFetchStatus":1,"OneWelcomeUserId":"","_oneWelcomeUserIdInDataFetchStatus":1,"IsCustomerUnderAge":false,"_isCustomerUnderAgeInDataFetchStatus":1,"UserStoreId":"0","_userStoreIdInDataFetchStatus":1,"IsTimetraveler":false,"_isTimetravelerInDataFetchStatus":1,"IsNextWeekPromotions":false,"_isNextWeekPromotionsInDataFetchStatus":1}}}';

/** A tiny cookie jar so we can carry the session cookies between requests. */
class CookieJar {
  private jar = new Map<string, string>();
  store(res: Response) {
    const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(name: string): string | undefined {
    return this.jar.get(name);
  }
}

interface PlusSession {
  jar: CookieJar;
  csrf: string;
  moduleVersion: string;
  apiVersion: string;
}

/** Establish the cookies + CSRF + version tokens needed to call the DataAction. */
async function bootstrap(): Promise<PlusSession> {
  const jar = new CookieJar();
  const get = async (path: string) => {
    const res = await fetch(`${ORIGIN}${path}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9", Cookie: jar.header() },
    });
    jar.store(res);
    return res;
  };

  // 1. Session cookies (Imperva).
  await get("/aanbiedingen");
  // 2. Module version token.
  await sleep(REQUEST_DELAY_MS);
  const mvi = (await (await get("/moduleservices/moduleversioninfo")).json()) as { versionToken?: string };
  const moduleVersion = mvi.versionToken;
  if (!moduleVersion) throw new Error("PLUS: no module version token");
  // 3. Api version token from the DataAction's client module.
  await sleep(REQUEST_DELAY_MS);
  const js = await (await get(MVC_JS)).text();
  const apiVersion = js.match(
    /"screenservices\/[^"]*DataActionGetPromotionList_Optimization",\s*"([^"]+)"/,
  )?.[1];
  if (!apiVersion) throw new Error("PLUS: could not extract api version from module JS");
  // 4. Prime the anti-CSRF cookie with a throwaway (expected-403) POST.
  await sleep(REQUEST_DELAY_MS);
  const prime = await fetch(`${ORIGIN}${DATA_ACTION}`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json",
      "OutSystems-locale": "nl-NL",
      Cookie: jar.header(),
    },
    body: '{"versionInfo":{"moduleVersion":"","apiVersion":""}}',
  });
  jar.store(prime);
  const csrf = decodeURIComponent(jar.get("nr2Users") ?? "").match(/crf=([^;]+)/)?.[1];
  if (!csrf) throw new Error("PLUS: could not obtain CSRF token");

  return { jar, csrf, moduleVersion, apiVersion };
}

/** POST the promotions DataAction for one period and return the parsed JSON. */
async function fetchPromotions(session: PlusSession, nextWeek: boolean): Promise<PlusResponse> {
  const body = JSON.parse(SCREEN_TEMPLATE);
  body.versionInfo = { moduleVersion: session.moduleVersion, apiVersion: session.apiVersion };
  body.screenData.variables.PromotionPeriodId = nextWeek ? 2 : 1;
  body.screenData.variables.IsNextWeekPromotions = nextWeek;

  const res = await fetch(`${ORIGIN}${DATA_ACTION}`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json",
      "OutSystems-locale": "nl-NL",
      "X-CSRFToken": session.csrf,
      Cookie: session.jar.header(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PLUS promotions POST → ${res.status}`);
  const json = (await res.json()) as PlusResponse & {
    versionInfo?: { hasModuleVersionChanged?: boolean; hasApiVersionChanged?: boolean };
    exception?: { message?: string };
  };
  if (json.exception?.message) throw new Error(`PLUS API: ${json.exception.message}`);
  if (json.versionInfo?.hasModuleVersionChanged || json.versionInfo?.hasApiVersionChanged) {
    throw new Error("PLUS: version tokens went stale mid-scrape (module redeployed)");
  }
  return json;
}

// --- Orchestration ----------------------------------------------------------

async function scrape(): Promise<ScrapedOffer[]> {
  const today = new Date();
  const session = await bootstrap();

  const current = await fetchPromotions(session, false);
  const offers = parsePlusResponse(current, today);
  if (process.env.SCRAPE_DEBUG) console.error(`  [plus] ${offers.length} current offers`);

  // Next week, when PLUS has published it (else the toggle simply stays empty).
  if (current.data?.IsNextWeekPublished) {
    try {
      // The latest START date among current offers — next week's offers begin after
      // it, so we keep only genuinely future ones and never re-date the current week
      // (offer-plan scopes by ISO week of validFrom). Comparing to the latest START,
      // not the latest end, avoids a multi-week current promo swallowing next week.
      const latestCurrentStart = offers.reduce(
        (max, o) => (o.validFrom > max ? o.validFrom : max),
        new Date(0),
      );
      await sleep(REQUEST_DELAY_MS);
      const next = parsePlusResponse(await fetchPromotions(session, true), today);
      const future = next.filter((o) => o.validFrom > latestCurrentStart);
      offers.push(...future);
      if (process.env.SCRAPE_DEBUG) console.error(`  [plus] +${future.length} next-week offers`);
    } catch (err) {
      if (process.env.SCRAPE_DEBUG) console.error(`  [plus] next-week fetch failed: ${(err as Error).message}`);
    }
  }

  if (offers.length === 0) throw new Error("No PLUS offers found (promotions API may have changed).");
  return offers;
}

export const plus: Scraper = {
  slug: "plus",
  name: "PLUS",
  logoUrl: "/logos/plus.svg",
  scrape,
};
