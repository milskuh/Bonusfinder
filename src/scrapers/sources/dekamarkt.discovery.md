# DekaMarkt — source discovery

Live inspection on **2026-08-06**. Unofficial and subject to change.

## Source

- **URL:** `https://www.dekamarkt.nl/aanbiedingen` (one GET, no auth, desktop UA).
- **Not used:** the Nuxt payload and the signed-in GraphQL gateway
  (`web-deka-gateway.dekamarkt.nl/graphql`) / `api.dekamarkt.nl`. The public
  `/aanbiedingen` page already server-renders the whole weekly ad as HTML cards —
  no XHR fires for the offer list (verified in the Network tab), so plain `fetch`
  + cheerio is enough, exactly like Dirk/Hoogvliet.
- **robots.txt** (`www.dekamarkt.nl/robots.txt`): only `/misc/*` is Disallowed for
  `User-agent: *`, then `Allow: /` — `/aanbiedingen` is crawlable. Plain `fetch`
  returns HTTP 200 (~950 KB), no bot-challenge.
- Gentle: one request, realistic desktop UA, `Accept-Language: nl-NL`.

> DekaMarkt is Detailresult Groep (like Dirk), but its markup is its **own**
> (`article.product__card`, not Dirk's cards), so the two scrapers share no
> parsing. The `formulaId=1` app-API lead from the brief was **not** needed — the
> public web page is a cleaner, header-free source.

## Data shape — server-rendered cards (cheerio)

```
button.active "t/m ma 10 aug"                 ← current period END date (in header)
section.offers__department > h3               ← department heading (category fallback)
  article.product__card[data-product-id]      ← one offer
    img.image[src=…?width=190]                  ← image (drop ?width= for canonical)
    p.title                                     ← product name
    span.addition "Fles 1.5 liter."             ← pack size (OPTIONAL)
    span.packaging "…alleen geldig op vrijdag 7 augustus"  ← single-day / limit note (OPTIONAL)
    div.chip "actie! 4,99" | "1+1 GRATIS" | …   ← promo label → offerText
    div.prices__offer "3."+"99"                 ← sale price (split spans → 3.99)
    span.regular.regular-strike "5.99"          ← original / was price (OPTIONAL)
```

2026-08-06: **110 unique offers** across 14 departments. Cards have **no** public
per-product URL → `deepLink` is null (honest; not fabricated).

### Prices & the multi-buy gotcha (the whole risk)

`.prices__offer` renders euros + cents in split `<span>`/`<small>` (→ "3.99");
`.regular-strike` is a plain "5.99" (absent when there's no was-price). **Crucially
DekaMarkt shows an effective *per-unit* price even for bundle deals:**

| chip           | `.prices__offer` | `.regular-strike` | meaning |
|----------------|------------------|-------------------|---------|
| `actie! 4,99`  | 4.99             | 9.99              | straight cut → normalize computes % |
| `25% KORTING`  | 1.12             | 1.49              | real per-unit cut → 25% (computed) |
| `1+1 GRATIS`   | 1.85             | 3.70              | **half** = per-unit-after-1+1 (synthetic!) |
| `2+1 GRATIS`   | 5.70             | 8.55             | 2/3 = per-unit-after-2+1 (synthetic!) |
| `2 voor 4,99`  | 4.99             | *(none)*          | bundle price, no was-price |

So we pass `{ salePrice: .prices__offer, originalPrice: .regular-strike, offerText:
.chip }` straight into `normalize.ts`. Its `isMultiBuyOffer()` matches `1+1` /
`gratis` / `N voor P` and **drops** the original + discount for those (rides on
`offerText`), so no misleading "50% off" is ever synthesised from the half-price.
A `% KORTING` / `actie!` cut is not a multi-buy, so its real % is kept. Verified:
"1+1 GRATIS" → sale 1.85, orig null, % null; "25% KORTING" → sale 1.12, orig 1.49,
% 25.

### Validity — read from the header (don't hardcode)

`button.active` reads e.g. **"t/m ma 10 aug"** → the current period's end date. The
DekaMarkt `/aanbiedingen` cycle runs **Tue→Mon** (t/m ma 10 aug ⇒ from Tue 4 aug),
so `validFrom = end − 6 days`, `validUntil = end` (23:59). (The brief's "start
maandag" is the physical folder; the online page ends Monday — we read the live
header, not an assumption.)

A card's `.packaging` note can pin it to a single day
("…alleen geldig op zaterdag 8 augustus", common in "Extra weekend voordeel") →
that one day overrides the weekly window. Quantity-only notes ("max. 2 per klant")
carry no date and are ignored for validity.

## Mapping decisions

- **Category:** `categorize(name, [addition])` first (a name keyword wins); when
  that yields `HOUDBAAR`, fall back to the department `<h3>` via
  `mapDekaSectionCategory` (the AH/Dirk pattern). Mixed aisles ("Extra weekend
  voordeel", "Koopjesmarkt", "Voorraadkast", "Maaltijden…", "Bloemen…") map to null
  so their items keep the name bucket. Tuning the heading map moved HOUDBAAR from
  43 → 26 and DRANKEN 10 → 20.
- **content/unit:** parsed from `.addition` ("Fles 1.5 liter." → 1.5 l,
  "Doos 15 stuks." → 15 stuk, "Stuk 650 - 675 gram." → 0.675 kg keeping the last
  of a range), else null.
- **image:** `img.image` src with the `?width=` hint stripped.

## Result

`npm run db:scrape -- dekamarkt --dry` → ~**110** offers; ~77 with a real
was→now discount, 16 multi-buy (no synthetic %), single-day weekend items dated to
their day.
