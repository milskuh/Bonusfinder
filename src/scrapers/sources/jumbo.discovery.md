# Jumbo — source discovery

Live inspection on **2026-07-30**. Unofficial and subject to change.

## Source

- **URL:** `https://www.jumbo.com/aanbiedingen/nu` (one GET, no auth, no headers
  beyond a realistic desktop User-Agent).
- **Not used:** `jumbo.com/acties/weekaanbiedingen` embeds a Publitas magazine
  (graphical leaflet, no structured data) — avoided as instructed.
- **robots.txt** (`www.jumbo.com/robots.txt`): only Disallows internal keyword
  search (`/producten/*?searchType=keyword…`) and login/personal pages
  (`/mandje/`, `/mijn/`, `/bestellingen/`). **`/aanbiedingen/` is allowed.** One
  polite request is well within the rules.
- No CAPTCHA / bot-challenge encountered: a plain `fetch` with a desktop UA
  returns HTTP 200 and the full page (~800 KB).

## Data shape

The page is a **Nuxt 3 (Vue) SSR app**. The offer list is **not** fetched by a
client-side XHR we could call directly — it is server-rendered and **inlined**
into the HTML as the Nuxt payload:

```html
<script type="application/json" id="__NUXT_DATA__"> [ …devalue flat array… ] </script>
```

This is **devalue** format: a flat JSON array where each object/array field
value is an **index into the array** (shared values stored once). We
`JSON.parse` it and "unflatten" by resolving those indices (see
`unflattenNuxtData` in `jumbo.ts`), then collect every node with
`__typename === "Promotion"`.

- Also checked `mobileapi.jumbo.com` (the AH-style app API): the host is live
  (nginx) but the promotion endpoints/versions we tried all 404'd. The inlined
  SSR payload is the reliable, documented-enough source, so we use that. No
  headless browser needed.

### Promotion object (fields we use)

```jsonc
{
  "__typename": "Promotion",
  "id": "3018870", "uuid": "…",
  "title": "Alle Ariel of Lenor",     // product/promo name
  "subtitle": null,
  "group": "Week",                     // "Week" (weekly) | "Seizoen" (season-long)
  "active": true, "hidden": false,
  "image": "https://www.jumbo.com/INTERSHOP/static/.../X.png",  // absolute
  "url": "/aanbiedingen/alle-ariel-of-lenor/3018870",           // relative deep link
  "start": { "iso": "2026-07-29T00:01:00+02:00" },
  "end":   { "iso": "2026-08-04T23:59:59+02:00" },  // Jumbo week = Wed→Tue
  "tags": [ { "text": "1+1 gratis", "inverse": false } ],
  "volumeDiscounts": []                // always empty in the overview
}
```

- **99 promotions** in the payload on 2026-07-30 (76 `Week`, 23 `Seizoen`).
- **Validity:** `start.iso` / `end.iso` → `validFrom` / `validUntil`. Weekly
  deals run 2026-07-29 (Wed) → 08-04 (Tue), some to 08-11.
- **Images:** absolute URLs on `www.jumbo.com/INTERSHOP/static/…` (verified 200,
  image/png).
- **Deep links:** `origin + url`, e.g.
  `https://www.jumbo.com/aanbiedingen/alle-ariel-of-lenor/3018870` (verified 200).

## Prices & promo mechanics

Jumbo's overview is **promotion-centric like Albert Heijn**: there is **no
structured per-unit price** (`volumeDiscounts` is always empty). The deal lives
entirely in the tag text. A tile can carry a **channel modifier** tag
(`Alleen online`, `Alleen in de slijterij`) alongside the deal tag — we skip
those and read the real deal tag.

Tag → mapping (see `parseJumboPrice`):

| Tag example        | Meaning              | `salePrice`      | `offerText`      |
|--------------------|----------------------|------------------|------------------|
| `voor 1,99`        | fixed price          | `1.99`           | `voor 1,99`      |
| `2 voor 6,00`      | bundle (N-voor-P)    | `6.00` (bundle)  | `2 voor 6,00`    |
| `1+1 gratis`       | multi-buy            | `null`           | `1+1 gratis`     |
| `2e halve prijs`   | multi-buy            | `null`           | `2e halve prijs` |
| `25% korting`      | percentage           | `null`           | `25% korting`    |
| `1,00 korting`     | euro-off (no price)  | `null`           | `1,00 korting`   |

- `originalPrice` and `discountPercent` are **always null** — the overview never
  exposes a "was" price, and we **never synthesise a percentage** from a `%`
  tag (per `normalize.ts`). The `voor X` / `N voor P` price convention matches
  the existing AH scraper (`DISCOUNT_FIXED_PRICE` / `DISCOUNT_X_FOR_Y`).
- These tag strings are the same ones the F4 savings calculator prices
  (`1+1 gratis`, `2e halve prijs`, `N voor P`, `% korting`).

## Decisions

- **`Seizoen` group excluded.** Those are season-long marketing banners (valid
  for months, e.g. Feb→Dec), not weekly deals — out of place in a weekly-offers
  feed and would linger for months. We keep only the weekly promotions. Net:
  **99 promotions → 65 weekly offers** with a real deal tag.
- **Category:** `categorize(title, [subtitle, deslug(url)])`. Jumbo's overview
  has no product-department label to fall back to, so tiles like "Alle \<brand\>"
  with no food keyword land in `HOUDBAAR` (best-effort, as elsewhere). The
  de-slugged deep-link (e.g. `…-wasmiddel`) recovers some (→ `HUISHOUDEN`).
- **One request total** — the whole ad is in the single page payload; no
  pagination, no per-offer fetches. Gentlest of the three existing scrapers.

## Result

`npm run db:scrape -- jumbo --dry` → **65 offers** in ~0.5 s. Verified live in
the feed (Jumbo-yellow branding, prices, deals, validity, images, deep links).
