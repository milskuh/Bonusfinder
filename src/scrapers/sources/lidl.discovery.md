# Lidl — source discovery

Live inspection on **2026-07-30**. Unofficial and subject to change.

## Headline: Lidl is NOT walled off (the brief's premise was outdated)

The brief expected `lidl.nl` to disallow automated access site-wide and to
require going through a backend/app API (AH-style), with a possible bot-protection
hard stop. **Verified live, that is not the case** — no API, no bot challenge,
no login needed:

- **robots.txt** (`www.lidl.nl/robots.txt`) is *not* a blanket block. It only
  Disallows `/cc.js*`, `/cdn/assets/cwv/`, `/user-api/*`, `/cqe/*`, and a set of
  **query-param** patterns (`*?offset=*`, `*id=*`, `*sort=*`, `*pageId=*`,
  `*productsOnly=*`, `*idsOnly=*`, `*search?q=*`, `*advisor=*`). The offers page
  path itself is **allowed**.
- A **plain `fetch`** of the homepage and the offers page returns **HTTP 200**
  with no CAPTCHA / WAF / Incapsula challenge. (The `blocked` string in the HTML
  is a hidden `n-header__blocked-customer` UI element — a false positive.)
- The products are **server-rendered inline** in the offers page HTML as
  `data-grid-data="{…}"` attributes (HTML-entity-encoded JSON) on each tile — no
  client-side product API call is needed at all. (The `/cqe/*` path only serves
  images here, and we never touch it.)

So we scrape it the gentle, plain-HTTP way — **no headless browser, no app API,
robots-permitted** — which is why this shipped as a working scraper, not a
hard-stop doc.

## Source

- **Homepage:** `https://www.lidl.nl/` → discover the current offers URL
  (`/c/aanbiedingen/a<digits>` — the id rotates, so we read it from the homepage
  rather than hard-coding). It appeared 7× on 2026-07-30 as
  `/c/aanbiedingen/a10008785`.
- **Offers page:** that URL → parse the inline `data-grid-data` tiles.
- Two requests total, a ~1.2 s pause between, realistic desktop UA. No query
  params (so none of the Disallowed `*?…` patterns apply); no `/cqe/` or
  `/user-api/` fetches.

## Data shape

Each product tile carries a `data-grid-data` attribute — decode the HTML
entities (`&quot;`→`"`, …) and `JSON.parse`:

```jsonc
{
  "productId": "p10031071",
  "fullTitle": "NESCAFÉ Gold", "title": "NESCAFÉ Gold",
  "brand": { "showBrand": false },        // brand is in the title; no name here
  "productType": "RETAIL",                // skip non-RETAIL / gift cards
  "havingPrice": true, "isLidlGiftCard": false, "preventSelling": false,
  "canonicalPath": "/p/nescafe-gold/p10031071",  // → deep link
  "image": "https://imgproxy-retcat.assets.schwarz/…png",
  "storeStartDate": 1785103200, "storeEndDate": 1785707999,  // unix seconds
  "price": {
    "price": 6.49,                        // → salePrice
    "oldPrice": 9.89,
    "discount": { "deletedPrice": 9.89, "discountText": "-34%", "percentageDiscount": 34 },
    "packaging": { "text": "200 g" }      // → contentAmount/Unit for unit price
  }
}
```

- **127 tiles** on 2026-07-30, all `productType: RETAIL`. **86** become offers;
  the other **41 are price-less teaser/section tiles** (e.g. "Hele
  bio-assortiment") with an empty `price` object — correctly skipped.
- A product can appear as both a price-less teaser and its real priced tile, so
  `parseGridData` **dedupes by productId, preferring the priced occurrence** (a
  teaser must not shadow the price).
- **Validity:** `storeStartDate`/`storeEndDate` (unix seconds). Lidl week is
  **Mon→Sun**; some items start mid-week.
- **Images:** `imageList_V1[0].image` / `image` on `imgproxy-retcat.assets.schwarz`
  (verified 200, image/png).
- **Deep link:** `origin + canonicalPath` (verified 200).

## Prices & promo mechanics

Lidl exposes a real **was → now** price, so — like Hoogvliet and Aldi — prices
flow through the shared **`normalize.ts`** (one canonical discount rule):

| Case                    | salePrice     | originalPrice          | discountPercent |
|-------------------------|---------------|------------------------|-----------------|
| price + deletedPrice    | `price.price` | `discount.deletedPrice`| computed        |
| price only (no was)     | `price.price` | null                   | null            |

- **No multi-buy** deals were present in the food leaflet (0 of 127) — all
  simple discounts — so `offerText` stays null. The `-X%` discount is **computed
  from the prices** by `normalize.ts`, not taken from `discountText` (never
  synthesised).
- **Unit price:** `price.packaging.text` ("200 g", "0,5 l", "2 x 250 g") is
  parsed to `contentAmount`/`contentUnit`, so `persist.ts` derives `pricePerUnit`
  (e.g. `32.45/kg`) — this even lets Lidl win the cross-store "beste deal" flag.

## Decisions

- **Category:** `categorize(name, [packaging.text])`. Lidl only tags a coarse
  `Food`/`Nonfood` here (useless for our fine taxonomy), so generic names fall
  back to `HOUDBAAR` (best-effort, as elsewhere).
- **URL discovery** from the homepage keeps the scraper working when the weekly
  campaign id rotates.

## Result

`npm run db:scrape -- lidl --dry` → **86 offers** in ~1.4 s (127 tiles − 41
price-less teasers). ~28 with a real discount. Verified live in the feed
(Lidl-blue branding, strikethrough was-prices, `-X%` badges, unit prices,
images, deep links; Lidl products even take some "beste deal" flags).
