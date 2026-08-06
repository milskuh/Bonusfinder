# Gall & Gall — source discovery

Live inspection on **2026-08-06**. Unofficial and subject to change.

## Source

- **URL:** `https://www.gall.nl/acties` + every clean `/acties/<category>/`
  sub-page it links to (wijn, whisky, bier, gin, wodka, rum, likeuren, jenever,
  port-en-sherry, mousserend, premix, cocktail, …). One GET each, no auth,
  desktop UA. Plus `https://www.gall.nl/acties/folders/` once, only to read the
  actie **end date**.
- **Platform:** Salesforce Commerce Cloud (SFCC/Demandware) — **not** an AH-style
  JSON app API. Offers are server-rendered `.ptile` tiles; there is no clean XHR
  offers endpoint to call (verified in the Network tab). So cheerio, like Dirk.
- **robots.txt** (`www.gall.nl/robots.txt`, updated 2026-04-20): for
  `User-agent: *`, Disallowed are checkout, search (`/zoeken`, `/*?q=`), the SFCC
  `*-Show` controllers, and filter/pagination params (`/*?start`, `/*?srule=`,
  `/*?prefn`, `/*_*`, `/*+`). The `/acties/**` category paths are **Allowed** (no
  query params, no underscores). `ClaudeBot` / `Claude-User` / `anthropic-ai` are
  even listed explicitly under the allowed AI crawlers.
- Gentle: sequential, ~1 s between pages, realistic desktop UA.

## Data shape — `data-product` JSON on each tile (the gift)

Each product tile carries a structured analytics payload:

```
div.c-product[data-pid]
  div.ptile[data-product='{ name, id, price, discount, brand, category, variant, promotionName }']
    a.ptile_link[href="/…-<id>.html"]          ← deep link (relative → absolute)
    img.img[srcset]                              ← image (take the widest srcset url)
  p.ptile_badges em span "2e halve prijs"        ← promo label (OPTIONAL) → offerText
```

- `price` = the **normal** price; `discount` = euros off ⇒ **salePrice = price −
  discount** (e.g. 6.65 − 1.66 = 4.99, matching the tile's "Van € 6.65 voor
  € 4.99"). `variant` = pack size ("75CL", "100CL", "1.5L", "1ST").
- `category` is a path ("Wijn/Rosé wijn/…", "Whisky", "Mixen", "Bier") — used both
  as `subcategory` and as the category fallback.

### Why per-category pages instead of pagination

SFCC's infinite grid loads more via `?start=` — **Disallowed** by robots (as are
the `*-Show` controllers). So we never paginate. Each `/acties/<cat>/` page serves
its own first ~16 tiles; walking all of them and deduping by product id yields the
full breadth: **~249 offers** on 2026-08-06 (almost entirely `DRANKEN`, correct
for a liquor store).

### Prices / promos (let normalize decide)

- **Straight cut** (no badge, `discount > 0`): pass `{ salePrice, originalPrice:
  price, offerText: null }` → normalize computes the % (25%, 18%, …).
- **Multi-buy badge** ("2e halve prijs", "2e fles 50% korting", "1+1 gratis"):
  per-unit `discount` is 0, so salePrice = the shelf price and we pass
  `originalPrice: null` (+ the badge as offerText). `isMultibuyBadge()` also guards
  the odd "2e …" phrasing normalize doesn't catch, so **no synthetic % is ever
  produced** for a bundle deal.
- **"OP=OP" / "Bijzondere whisky"** are flags, not mechanics — kept as offerText
  while the real price cut still computes its %.
- Tiles with **neither** a price cut nor a promo badge are skipped (filler /
  membership tiles like "Mijn Gall & Gall Premium"), so no non-offer is invented.

### Validity — a STABLE multi-week window (important)

Gall promos run **multi-week** ("geldig t/m zondag 23 augustus", folder banner
"wk 32-33-34"), unlike a weekly ad. `persist`/`offer-plan` match offers per
**(ISO week of validFrom, product)**, so if `validFrom` drifted between scrapes the
same product would land in a new week bucket and **duplicate**. We therefore:

1. read the end date off `/acties/folders/` ("t/m zondag 23 augustus" → 23 Aug
   23:59), and
2. derive `validFrom` deterministically from that fixed end date — the Monday of
   the ISO week two weeks earlier (`actiePeriod`). It never depends on the scrape
   day, so every run during the actie produces the **same** validFrom (one stable
   ISO-week bucket) and offers update in place. Fallback when the date can't be
   read: a two-week window ending today+14d.

## Mapping decisions

- **Category:** a drink keyword in the name wins (so a "cola" mixer → SODA);
  otherwise Gall's own `category` path decides and **overrides** a food bucket a
  name keyword produced ("STËLZ Mango" is a drink, not FRUIT). Non-drink Gall
  aisles (cadeau, accessoires, geschenk, waardebon) map to null and keep the name
  bucket. A few spirit keywords (jenever, cognac, brandy, vermout, tequila, sherry,
  bourbon, whiskey, gedistilleerd) were added to `categorize.ts` so brand-only
  names still land in DRANKEN.
- **brand:** taken straight from `data-product.brand`.
- **content/unit:** `variant` → litres for CL/ML/L, stuk for ST.
- **image:** widest `srcset` url (falls back to `src`, skipping the placeholder).
- **deepLink:** `a.ptile_link` href → absolute `…-<id>.html` product page.

## Result

`npm run db:scrape -- gall --dry` → ~**249** offers, ~221 straight discounts +
~28 promo/multi-buy (no synthetic %), all `validFrom … validUntil` = the actie
window (e.g. Mon 3 Aug → Sun 23 Aug 2026), deep links resolve to product pages.
