# Aldi — source discovery

Live inspection on **2026-07-30**. Unofficial and subject to change.

## Source

- **URL:** `https://www.aldi.nl/aanbiedingen.html` (one GET, no auth, desktop UA).
  `/aanbiedingen-deze-week.html` 301-redirects here.
- **Not used:** `aldi.nl/folders/folder-van-deze-week.html` is a client-rendered
  **iPaper graphical flipbook** (`folder.aldi.nl/…`, `ipaper.ipapercms.dk/…/Image.ashx`)
  — page images only, no structured data. A plain fetch of it returns just nav +
  `<meta>`. We do **not** OCR leaflet images.
- **robots.txt** (`www.aldi.nl/robots.txt`): Disallows some region pages
  (`/reg-*`, `/can/`, `/bal/`, `/mds/`) and filtered/query URLs
  (`/*?*filters`, `/*?*jobId=`). **`/aanbiedingen.html` is allowed.**
- No CAPTCHA / bot-challenge: plain `fetch` returns HTTP 200.

## Data shape — structured, not a leaflet

`aldi.nl` is a **Next.js** app. The offers page server-renders a **fully
structured** offer feed into its Next payload:

```
<script id="__NEXT_DATA__" type="application/json">
  { props: { pageProps: { apiData: "<JSON string>" } } }
</script>
```

`apiData` is a JSON **string** → parse again → an array of `[queryKey, data]`
entries (a dehydrated data cache). Take the `"OFFER_GET"` entry:

```jsonc
["OFFER_GET", { "req": { "locale": "nl", "week": "current" },
  "res": { "algoliaDataMap": { "<id>": { …product… }, … } } }]
```

`Object.values(algoliaDataMap)` = **193 products** (current week) on 2026-07-30.

### Product object (fields we use)

```jsonc
{
  "objectID": "1202915",
  "brandName": "MUCCI",              // → brand
  "name": "Special cornets",
  "salesUnit": "6 stuks",
  "mainCategoryID": "ijs",           // Aldi's own section → subcategory + hint
  "productSlug": "special-cornets-1202915",
  "assets": [{ "type": "primary", "url": "https://s7g10.scene7.com/is/image/aldinord/…" }],
  "currentPrice": {
    "priceValue": 1.89,                              // → salePrice
    "strikePrice": { "strikePriceValue": 2.99 },     // → originalPrice (was)
    "basePrice": [{ "basePriceValue": 3.71, "basePriceScale": "l" }],  // unit price
    "priceTagLabels": { "promoText1": "-36%" },      // badge; see below
    "validFrom": 1785103200, "validUntil": 1785707999 // unix seconds
  },
  "promotionPrices": [ … ]           // fallback for the price object
}
```

- **193/193** have `priceValue`; **36/193** have a real `strikePrice` (was
  price); **35/193** have a `basePrice` (per `kg`/`l`).
- **Validity:** `currentPrice.validFrom/validUntil` (unix seconds). Aldi week is
  **Mon→Sun** (validFrom → Monday), some items start mid-week.
- **Images:** `assets` (prefer `type:"primary"`) on `s7g10.scene7.com` (verified
  200, image/jpeg).
- **Deep link:** `https://www.aldi.nl/product/<productSlug>.html` (verified 200).

## Prices & promo mechanics

Because Aldi exposes a real **was → now** price, this is the one new source with
genuine discounts — so prices flow through the shared **`normalize.ts`**, exactly
like Hoogvliet (one canonical discount rule):

| Case                         | salePrice        | originalPrice | discountPercent | offerText     |
|------------------------------|------------------|---------------|-----------------|---------------|
| price + strike               | `priceValue`     | strike        | computed        | null          |
| price only (`OP=OP`/`VANAF`) | `priceValue`     | null          | null            | null          |
| `N VOOR` (multi-buy)         | `priceValue`†    | null          | null            | `N voor P,PP` |

† For `"N VOOR"`, `priceValue` is the **bundle** price for N (matches AH's
X-for-Y). We build `offerText = "2 voor 3,00"` and let `normalize.ts` keep
`salePrice` and drop the (bundle) was-price rather than **synthesise a
percentage**.

- `priceTagLabels.promoText1` is a badge (`-36%`, `OP=OP` = while-stocks-last,
  `VANAF` = from-price, `TOT -58%`, `N VOOR`). We only read `N VOOR` from it;
  the discount % is computed from prices (normalize), not taken from the badge.
- **Unit price:** we recover the pack size by dividing `salePrice / basePriceValue`
  and set `contentAmount` + `contentUnit`, so `persist.ts` reproduces Aldi's own
  `basePrice` as `pricePerUnit` (e.g. `3.71/l`). Skipped for multi-buys.

## Decisions

- **Not blocked.** Unlike the leaflet, the offers page carries clean structured
  product/price data, so Aldi is implemented (not a docs-only blocker).
- **Category:** `categorize(name, [brandName, salesUnit, mainCategoryID])`.
  Aldi's `mainCategoryID` is mostly generic (`offer`, `zomerassortiment`), so
  many generic names fall back to `HOUDBAAR` (best-effort, as elsewhere).
- **One request total** — the whole week is in the single page payload.

## Result

`npm run db:scrape -- aldi --dry` → **190 offers** in ~0.2 s (193 products − 3
unavailable/priceless). ~36 with a real discount. Verified live in the feed
(Aldi-blue branding, strikethrough was-prices, `-X%` badges, unit prices, the
`2 voor 3,00` multi-buy, images, deep links).
