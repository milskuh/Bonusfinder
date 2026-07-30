# Dirk — source discovery

Live inspection on **2026-07-30 / 2026-07-31**. Unofficial and subject to change.

## Source

- **URL:** `https://www.dirk.nl/aanbiedingen` (one GET, no auth, desktop UA). Also
  `https://www.dirk.nl/kanskoopjes` (non-food clearance) — same DOM, scraped too.
- **Not used:** `dirk.nl/folder` is the graphical leaflet (page images). The
  `/aanbiedingen` page carries the structured, server-rendered offer cards.
- **robots.txt** (`www.dirk.nl/robots.txt`): `User-agent: * / Allow: /` — fully
  crawlable. No CAPTCHA / bot-challenge: plain `fetch` returns HTTP 200 (~1 MB).
- Gentle regardless: sequential requests, a ~1.3 s pause between the two pages, a
  realistic desktop user-agent, `Accept-Language: nl-NL`.

## Data shape — server-rendered cards (parse with cheerio)

`dirk.nl` is a **Nuxt** app, but the whole weekly ad is server-rendered as HTML
cards (no need to touch the `__NUXT_DATA__` devalue blob). We parse the DOM with
cheerio, exactly like Hoogvliet.

```
section.department                     ← one per category, with an <h2> heading
  article[data-product-id="28162"]     ← one offer (id = stable product id = JSON-LD sku)
    a.top[href="/boodschappen/…/28162"]  ← deep link (ABSENT on offer-only cards → url null)
    img.main-image[src]                  ← image on web-fileserver.dirk.nl (drop ?width=)
    div.logos img[alt="Op=Op"]           ← while-stocks-last flag (only promo logo)
    div.price-container
      div.price-label span.description   ← "ACTIE" | "VR, ZA & ZO actie"
      span.regular-price " van 3.49"     ← ORIGINAL price (euros with a dot); OPTIONAL
      div.price
        span.price-large  "3"            ← see price rule below
        span.price-small  "99"           ← cents (OPTIONAL)
    a.bottom p.title                     ← product name
    a.bottom span.subtitle "Zak 1 kilo." ← pack size (OPTIONAL)
```

`/aanbiedingen` on 2026-07-30: **108 cards → 99 unique** products (9 items are
mirrored in the first "Weekendverwenners" section *and* their category section,
with identical price/label — deduped by `data-product-id`). `/kanskoopjes`: 43
cards. Only **40/108** cards are catalogued (have a `/boodschappen/…` deep link,
and those are exactly the 40 in the page's JSON-LD `ItemList`); the other 68 are
offer-only (`url` null).

### THE price rule (gotcha #1 — the whole risk)

The sale price is split across two spans, and the euros/cents split is signalled
by a **class**, not by a separator:

| DOM                                                            | price   |
|---------------------------------------------------------------|---------|
| `<span class="hasEuros price-large">3</span><span class="price-small">99</span>` | €3.99 |
| `<span class="hasEuros has10Euros price-large">14</span><span class="price-small">96</span>` | €14.96 |
| `<span class="price-large">49</span>` *(no `hasEuros`, no cents span)*           | **€0.49** |
| `<span class="price-large">99</span>` *(no `hasEuros`)*                          | **€0.99** |

- **`hasEuros` present** → `price-large` is **euros**, `price-small` is cents →
  `euros + cents/100` (cents span may be absent for a whole-euro price → `+0`).
- **`hasEuros` absent** → `price-large` is the **whole price in integer cents** →
  `value / 100`. This is the "`49` = €0.49" case; a naïve parse reads €49. We key
  off the `hasEuros` class (not merely "is there a cents span?") so a future
  whole-euro price (`hasEuros`, `price-small` absent) still reads correctly.

Verified against the page's JSON-LD `offers.price`: Suikermais (`49`, no
`hasEuros`) → JSON-LD `0.49`; Appelkruimelvlaai (`3`+`99`) → JSON-LD `3.99`. ✓

### Deal labels (`span.description`) — the only two seen

- **`ACTIE`** (90×). With a `regular-price` "van X.XX" → real was→now discount
  (→ `normalize.ts` computes the %). Without one → sale price only, `originalPrice`
  and `discountPercent` null (never synthesised).
- **`VR, ZA & ZO actie`** (18×, = the 9 weekend products ×2) → **weekend-only**,
  see validity. May also carry a `regular-price`.
- **`Op=Op`** logo (15×, also sometimes in the subtitle) → folded into `offerText`.
- **No multi-buy** (`1+1 gratis`, `2e halve prijs`, `N voor P`) appears in any
  card's visible text this week — Dirk is straight price cuts. Prices still flow
  through `normalize.ts`, which would keep `salePrice`-only for a multi-buy
  `offerText` if one ever appears.

### Validity — read from the page header (don't hardcode)

The header exposes the current period's **end** date and the next period's start:

```
button.calender-button.current  →  .day "di"  .date "4 augustus"   (tot en met)
button.calender-button          →  .day "wo"  .date "5 augustus"   (vanaf, next week)
```

- **`validUntil`** = the `.calender-button.current .date`, at 23:59:59 (year
  inferred, Dec→Jan wrap handled).
- **`validFrom`** = `validUntil − 6 days` (00:00). Dirk's `/aanbiedingen` runs
  **Wed → Tue** (di 4 aug → wo 29 jul). `/kanskoopjes` runs a *different* cycle —
  **Sun → Sat** (za 1 aug) — so reading the end date per page (not assuming Tue)
  is what makes both correct; both are 7-day windows so `end − 6` holds.
- **Weekend-only** (`VR, ZA & ZO actie`): scoped to the Fri–Sun inside the period.
  `validFrom` = the Friday in `[from, until]` (00:00), `validUntil` = that Sunday
  (23:59:59). This week: Fri 31 jul → Sun 2 aug. Also noted in `offerText`.

The feed's active filter is `validUntil >= now` (`lib/queries/offers.ts`), so a
correct `validUntil` is what keeps weekend/expired offers scoped right.

## Mapping decisions

- **Category:** `categorize(name, [subtitle])` first (a name keyword wins); when
  that yields the `HOUDBAAR` catch-all, fall back to Dirk's section `<h2>` via an
  explicit `DIRK_SECTION_CATEGORY` map (the AH pattern). The raw heading is **not**
  fed to `categorize()` — headings like "Vlees, vis & vega" contain several
  category keywords and would mis-fire (a biefstuk would hit "vis").
- **`offerText`:** `VR, ZA & ZO actie` (weekend) and/or `Op=Op`, joined; else null.
  Never a price. `normalize.ts` still computes the discount from `regular-price`
  because neither string is a multi-buy pattern.
- **content/unit:** parsed from `subtitle` ("Zak 1 kilo." → 1 kg, "24 x 300 ml" →
  7.2 l), else null. "Per stuk" (no number) → null.
- **image:** `img.main-image` src with the `?width=` hint stripped.
- **deepLink:** `a[href^="/boodschappen"]` → absolute, else null (offer-only).

## Result

`npm run db:scrape -- dirk --dry` → ~**99** offers from `/aanbiedingen` + ~**43**
from `/kanskoopjes`. ~84 with a real `regular-price` discount; 9 weekend-only; the
sub-€1 cents case (Suikermais €0.49) verified against JSON-LD.
