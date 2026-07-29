// src/lib/i18n.ts
// Lightweight i18n: a NL/EN string dictionary, a `t()` lookup with {param}
// interpolation, locale-aware date formatting, and a rule-based translator for
// the structured deal text ("1+1 gratis" → "1+1 free", "2 VOOR 4.99" → "2 for
// 4.99"). Product names are translated separately by Claude (Product.nameEn);
// everything here is deterministic and needs no API.

export type Locale = "nl" | "en";
export const LOCALES: Locale[] = ["nl", "en"];
export const DEFAULT_LOCALE: Locale = "nl";

/** UI strings. Keys are shared; every key must exist in both languages. */
const DICT = {
  nl: {
    "nav.favorites": "Favorieten",
    "nav.language": "Taal",
    "offers.title": "Aanbiedingen",
    "offers.count": "{n} actieve aanbiedingen",
    "offers.loading": "Aanbiedingen laden…",
    "offers.empty": "Geen aanbiedingen in deze categorie.",
    "sort.newest": "Nieuwste",
    "sort.discount": "Hoogste korting",
    "sort.price": "Laagste prijs",
    "sort.unitPrice": "Prijs per eenheid",
    "filter.all": "Alle",
    "card.bestDeal": "Beste deal",
    "card.bonus": "Bonus",
    "card.noImage": "Geen afbeelding",
    "card.validUntil": "Geldig t/m {date}",
    "pager.prev": "Vorige",
    "pager.next": "Volgende",
    "pager.page": "Pagina {page} van {count}",
    "fav.add": "Voeg toe aan favorieten",
    "fav.remove": "Verwijder uit favorieten",
    "fav.login": "Log in om te bewaren",
    "favorites.title": "Mijn favorieten",
    "favorites.none": "Geen actieve aanbieding",
    "favorites.cheapest": "Goedkoopst bij {market}",
    "favorites.empty": "Nog geen favorieten. Klik op het hartje bij een aanbieding om er een te bewaren.",
    "favorites.signedOut": "Log in om je favoriete producten te bewaren en te volgen.",
    "auth.login": "Inloggen",
  },
  en: {
    "nav.favorites": "Favorites",
    "nav.language": "Language",
    "offers.title": "Deals",
    "offers.count": "{n} active deals",
    "offers.loading": "Loading deals…",
    "offers.empty": "No deals in this category.",
    "sort.newest": "Newest",
    "sort.discount": "Highest discount",
    "sort.price": "Lowest price",
    "sort.unitPrice": "Unit price",
    "filter.all": "All",
    "card.bestDeal": "Best deal",
    "card.bonus": "Bonus",
    "card.noImage": "No image",
    "card.validUntil": "Valid until {date}",
    "pager.prev": "Previous",
    "pager.next": "Next",
    "pager.page": "Page {page} of {count}",
    "fav.add": "Add to favorites",
    "fav.remove": "Remove from favorites",
    "fav.login": "Log in to save",
    "favorites.title": "My favorites",
    "favorites.none": "No active deal",
    "favorites.cheapest": "Cheapest at {market}",
    "favorites.empty": "No favorites yet. Tap the heart on a deal to save one.",
    "favorites.signedOut": "Log in to save and follow your favorite products.",
    "auth.login": "Log in",
  },
} as const;

export type TKey = keyof (typeof DICT)["nl"];

/** Translate a UI key, interpolating {param} placeholders. */
export function t(locale: Locale, key: TKey, params?: Record<string, string | number>): string {
  let s: string = DICT[locale][key] ?? DICT.nl[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

/** Short date in the viewer's locale, e.g. "4 aug" (nl) / "4 Aug" (en). */
export function formatShortDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "nl-NL", {
    day: "numeric",
    month: "short",
  }).format(date);
}

// --- Deal-text (offerText) translation, rule-based -------------------------

const UNIT_NL_EN: Record<string, string> = {
  stuk: "piece", stuks: "pieces", pak: "pack", kuip: "tub", bus: "can",
  fles: "bottle", flessen: "bottles", zak: "bag", emmer: "bucket",
  beker: "cup", rol: "roll", pot: "jar", blik: "tin", doos: "box",
};

/**
 * Translate the structured Dutch promo label to English. Returns the original
 * string when no rule matches, so it degrades gracefully. NL deal text is
 * usually uppercase ("2 VOOR 4.99"); we normalise to sentence-ish English.
 */
export function translateOfferText(text: string | null, locale: Locale): string | null {
  if (!text || locale === "nl") return text;
  const s = text.trim();
  const lower = s.toLowerCase();

  // "1+1 gratis", "2 + 1 gratis"
  let m = lower.match(/^(\d+)\s*\+\s*(\d+)\s*gratis$/);
  if (m) return `${m[1]}+${m[2]} free`;

  // "3 voor 5.00" / "2 voor 4.99"
  m = lower.match(/^(\d+)\s*voor\s*([\d.,]+)$/);
  if (m) return `${m[1]} for ${m[2]}`;

  // "voor 2.99"
  m = lower.match(/^voor\s*([\d.,]+)$/);
  if (m) return `for ${m[1]}`;

  // "25% korting"
  m = lower.match(/^([\d.,]+)\s*%\s*korting$/);
  if (m) return `${m[1]}% off`;

  // "1.50 euro korting"
  m = lower.match(/^([\d.,]+)\s*euro\s*korting$/);
  if (m) return `€${m[1]} off`;

  // "2 stapelen tot 50%"
  m = lower.match(/^(\d+)\s*stapelen\s*tot\s*([\d.,]+)\s*%$/);
  if (m) return `buy ${m[1]}, up to ${m[2]}% off`;

  // "2e halve prijs" / "halve prijs"
  if (/halve\s*prijs/.test(lower)) return lower.replace(/(\d+)e\s*halve\s*prijs/, "$1nd half price").replace(/^halve prijs$/, "half price");

  // "per <unit> 2.99"
  m = lower.match(/^per\s+([a-z]+)\s*([\d.,]+)$/);
  if (m && UNIT_NL_EN[m[1]]) return `per ${UNIT_NL_EN[m[1]]} ${m[2]}`;

  // bare "gratis" / "bonus"
  if (lower === "gratis") return "free";
  if (lower === "bonus") return "Bonus";

  return text; // no rule matched — keep the original
}
