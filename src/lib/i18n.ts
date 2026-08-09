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
    "nav.basket": "Mandje",
    "nav.language": "Taal",
    "theme.toggle": "Wissel thema (nu: {mode})",
    "theme.light": "licht",
    "theme.dark": "donker",
    "theme.system": "systeem",
    "offers.title": "Aanbiedingen",
    "offers.subtitle": "Alle supermarktbonussen op één plek.",
    "offers.count": "{n} actieve aanbiedingen",
    "offers.activePill": "{n} actief",
    "offers.upcomingPill": "{n} volgende week",
    "offers.loading": "Aanbiedingen laden…",
    "offers.empty": "Geen aanbiedingen in deze categorie.",
    "offers.emptySearch": "Geen aanbiedingen gevonden voor deze zoekopdracht.",
    "offers.emptyUpcoming": "De aanbiedingen voor volgende week zijn nog niet bekend — kom later terug.",
    "offers.end": "Geen aanbiedingen meer",
    "offers.results": "Resultaten",
    "timeframe.label": "Periode",
    "timeframe.current": "Deze week",
    "timeframe.upcoming": "Volgende week",
    "search.placeholder": "Zoek producten…",
    "search.clear": "Wis zoekopdracht",
    "sort.label": "Sorteer op",
    "sort.newest": "Nieuwste",
    "sort.discount": "Hoogste korting",
    "sort.price": "Laagste prijs",
    "sort.unitPrice": "Prijs per eenheid",
    "filter.all": "Alle",
    "filter.stores": "Winkels",
    "card.bestDeal": "Beste deal",
    "card.bonus": "Bonus",
    "card.noImage": "Geen afbeelding",
    "card.validUntil": "Geldig t/m {date}",
    "card.validUntilShort": "t/m {date}",
    "card.validRange": "{from} t/m {until}",
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
    "basket.title": "Mijn mandje",
    "basket.signedOut": "Log in om je mandje samen te stellen en de goedkoopste boodschappen te vinden.",
    "basket.empty": "Je mandje is leeg. Voeg producten toe met het mand-icoon op een aanbieding.",
    "basket.itemsTitle": "Boodschappenlijst",
    "basket.count": "{n} producten",
    "basket.add": "Voeg toe aan mandje",
    "basket.removeFromBasket": "Verwijder uit mandje",
    "basket.addLogin": "Log in om toe te voegen",
    "basket.increase": "Meer",
    "basket.decrease": "Minder",
    "basket.optimizing": "Prijzen berekenen…",
    "basket.optimizeError": "Kon de goedkoopste combinatie niet berekenen.",
    "basket.multiStore.title": "Goedkoopst over winkels",
    "basket.multiStore.subtitle": "Elk product bij de goedkoopste winkel",
    "basket.multiStore.stores": "{n} winkels",
    "basket.singleStore.title": "Goedkoopste enkele winkel",
    "basket.singleStore.subtitle": "Alles in één keer bij één winkel",
    "basket.total": "Totaal",
    "basket.coverage": "Dekt {covered} van {total} producten",
    "basket.savings": "Je bespaart {amount}",
    "basket.savingsDetail": "{percent}% t.o.v. alles bij {store}",
    "basket.noPricedItems": "Nog geen producten met een vergelijkbare prijs.",
    "basket.needsAttention": "Vraagt om aandacht",
    "basket.needsAttentionHint": "Deze producten tellen niet mee in de totalen.",
    "basket.noPrice": "Geen losse prijs",
    "basket.noOffer": "Geen actieve aanbieding",
    "auth.login": "Inloggen",
    "auth.signup": "Registreren",
    "consent.message": "We gebruiken analytische cookies (Google Analytics) om te zien hoe de site gebruikt wordt. Deze worden alleen geplaatst als je ze accepteert.",
    "consent.accept": "Accepteren",
    "consent.decline": "Weigeren",
    "footer.cookieSettings": "Cookie-instellingen",
    "footer.tagline": "Alle supermarktaanbiedingen op één plek.",
  },
  en: {
    "nav.favorites": "Favorites",
    "nav.basket": "Basket",
    "nav.language": "Language",
    "theme.toggle": "Switch theme (now: {mode})",
    "theme.light": "light",
    "theme.dark": "dark",
    "theme.system": "system",
    "offers.title": "Deals",
    "offers.subtitle": "All supermarket deals in one place.",
    "offers.count": "{n} active deals",
    "offers.activePill": "{n} active",
    "offers.upcomingPill": "{n} next week",
    "offers.loading": "Loading deals…",
    "offers.empty": "No deals in this category.",
    "offers.emptySearch": "No deals found for this search.",
    "offers.emptyUpcoming": "Next week's deals aren't published yet — check back later.",
    "offers.end": "No more offers",
    "offers.results": "Results",
    "timeframe.label": "Timeframe",
    "timeframe.current": "This week",
    "timeframe.upcoming": "Next week",
    "search.placeholder": "Search products…",
    "search.clear": "Clear search",
    "sort.label": "Sort by",
    "sort.newest": "Newest",
    "sort.discount": "Highest discount",
    "sort.price": "Lowest price",
    "sort.unitPrice": "Unit price",
    "filter.all": "All",
    "filter.stores": "Stores",
    "card.bestDeal": "Best deal",
    "card.bonus": "Bonus",
    "card.noImage": "No image",
    "card.validUntil": "Valid until {date}",
    "card.validUntilShort": "until {date}",
    "card.validRange": "{from} – {until}",
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
    "basket.title": "My basket",
    "basket.signedOut": "Log in to build your basket and find the cheapest way to shop.",
    "basket.empty": "Your basket is empty. Add products with the basket icon on a deal.",
    "basket.itemsTitle": "Shopping list",
    "basket.count": "{n} products",
    "basket.add": "Add to basket",
    "basket.removeFromBasket": "Remove from basket",
    "basket.addLogin": "Log in to add",
    "basket.increase": "Increase",
    "basket.decrease": "Decrease",
    "basket.optimizing": "Calculating prices…",
    "basket.optimizeError": "Couldn't work out the cheapest combination.",
    "basket.multiStore.title": "Cheapest across stores",
    "basket.multiStore.subtitle": "Each product at its cheapest store",
    "basket.multiStore.stores": "{n} stores",
    "basket.singleStore.title": "Cheapest single store",
    "basket.singleStore.subtitle": "Everything in one trip",
    "basket.total": "Total",
    "basket.coverage": "Covers {covered} of {total} products",
    "basket.savings": "You save {amount}",
    "basket.savingsDetail": "{percent}% vs everything at {store}",
    "basket.noPricedItems": "No products with a comparable price yet.",
    "basket.needsAttention": "Needs attention",
    "basket.needsAttentionHint": "These items aren't included in the totals.",
    "basket.noPrice": "No single price",
    "basket.noOffer": "No active deal",
    "auth.login": "Log in",
    "auth.signup": "Sign up",
    "consent.message": "We use analytics cookies (Google Analytics) to see how the site is used. They're only set if you accept them.",
    "consent.accept": "Accept",
    "consent.decline": "Decline",
    "footer.cookieSettings": "Cookie settings",
    "footer.tagline": "All supermarket deals in one place.",
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

  // "op=op" / "op = op" — very common on Dirk cards
  if (/^op\s*=\s*op$/.test(lower)) return "While stocks last";

  // bare "gratis" / "bonus"
  if (lower === "gratis") return "free";
  if (lower === "bonus") return "Bonus";

  return text; // no rule matched — keep the original
}
