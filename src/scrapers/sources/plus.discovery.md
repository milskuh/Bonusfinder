# PLUS — source discovery

Live inspection on **2026-08-08**. PLUS is scraped via its **webshop promotions
API** (an internal OutSystems DataAction), the AH-pattern "read the app's own JSON
endpoint" approach — plain `fetch`, no headless browser. Code: `sources/plus.ts`.

## The source

`plus.nl/aanbiedingen` is a client-rendered **OutSystems Reactive** SPA (the HTML
shell is ~8 KB and says nothing). Its promo grid is filled by a single POST:

```
POST https://www.plus.nl/screenservices/ECP_Composition_CW/Promotions/
     Promotion_LP_Content_TF_OptimizationECOP9566/DataActionGetPromotionList_Optimization
```

One call returns **every** promo category with its offers — ~137 real offers this
week across 18 category buckets (plus a "Gratis bezorging" free-delivery bucket we
drop), and, when published, next week too. No pagination needed.

### Response shape (fields we use)

`data.PromotionOfferList.List[]` — each element carries:

- `Category` → `{ CategoryLabel, Offers.List[] }` — the bulk of the offers.
- `ProductPromotionTiles.List[]` — featured "tiles" on a banner; some are
  banner-only (e.g. a "3 VOOR 5.99" pizza), so we parse these too and dedupe by
  `Slug`.

Per offer: `Brand`, `Name`, `Variant`, `Package`, `Slug` (`"4441-168"`),
`ImageURL` (Contentful CDN, sometimes protocol-relative `//images…`), `NewPrice`
(the sale price), `PriceOriginal_Lowest`/`_Highest` (the pre-discount "from"
range), `DisplayInfo_Label` (`""` | `"1+1 GRATIS"` | `"3 VOOR 5.00"` |
`"2E HALVE PRIJS"` | `"25 % KORTING"` | `"500 GRAM 1.19"` | …), `StartDate`,
`EndDate`, `IsFreeDeliveryOffer`, `IsProductOverMajorityAge`/`Product_IsNIX18`
(alcohol/age flags).

Deep link per offer: `https://www.plus.nl/aanbiedingen/<Slug>`.

## Reproducing the request from Node (the tricky part)

The endpoint sits behind **Imperva/Incapsula** and OutSystems' anti-CSRF +
per-deploy version checks. A plain `curl` of the endpoint returns
`403 "Invalid Login"`. Everything needed is discoverable at scrape time, so nothing
is hardcoded except the endpoint paths and the (rarely-changing) request-body
template. The bootstrap `sources/plus.ts` performs:

1. `GET /aanbiedingen` — passes Imperva (a real desktop UA is enough; the JSON
   endpoint is not JS-challenged) and picks up the session cookies.
2. `GET /moduleservices/moduleversioninfo` → `{"versionToken":"…"}` = the
   **moduleVersion**.
3. `GET /scripts/…Promotion_LP_Content_TF_OptimizationECOP9566.mvc.js` and read the
   **apiVersion** from the `callDataAction("…/DataActionGetPromotionList_Optimization",
   "<apiVersion>", …)` registration. The unhashed script path serves the current
   file, so we don't need the manifest.
4. A **throwaway POST** to the DataAction with an empty versionInfo → `403`, but the
   response `Set-Cookie: nr2Users` carries the anti-CSRF token as `crf=<token>`
   (URL-encoded). We echo it as the `X-CSRFToken` header on the real call.

Then POST the DataAction with headers `Accept: application/json`,
`Content-Type: application/json; charset=UTF-8`, `OutSystems-locale: nl-NL`,
`X-CSRFToken: <crf>` and the body template (`SCREEN_TEMPLATE` in `plus.ts`), with
`versionInfo` + `PromotionPeriodId` + `IsNextWeekPromotions` overridden. The body is
the app's real `screenData` payload; the server rejects a trimmed body with
`400 "Failed to parse JSON request content"`, so we keep it intact.

A stale versionInfo comes back as `{hasModuleVersionChanged|hasApiVersionChanged:true}`
with empty `data` (not an error); the scraper treats that as "module redeployed
mid-scrape" and throws a clear message.

## Known, baked-in facts

- **Validity**: PLUS weeks run **Wednesday → Tuesday**. Each offer carries its own
  `StartDate`/`EndDate`, so we use those directly.
- **Next week**: exposed via `data.IsNextWeekPublished` + `PromotionPeriodId: 2` /
  `IsNextWeekPromotions: true`. We fetch it and keep only offers that start after the
  current week's latest start date, so next-week deals fill the app's "next week"
  toggle ahead of rollover. Empty until PLUS publishes it — never faked.
- **Franchise scoping**: PLUS stores are independently operated, but the anonymous
  webshop default is `StoreNumber: 0` — a **national** feed, which is exactly the
  "one national feed" this app models. We use it and do not model per-store pricing.
- **Multi-buy promos** ("1+1 GRATIS", "3 VOOR 5.00", "2E HALVE PRIJS") carry a
  `NewPrice` (what you pay) but no honest single "was" price, so the mechanic goes in
  `offerText` and `normalize.ts` suppresses any synthetic percentage. Straight cuts
  and "% KORTING"/"€ KORTING" labels keep `NewPrice` + `PriceOriginal_Lowest` (the
  conservative, never-overstated "from" price) and get a computed percentage.
- **Alcohol**: the `"Wijn, bier, sterke drank"` aisle backstops alcohol whose name is
  only a brand list ("Desperados, Texels en Leffe"), via the categorize() section
  fallback — same pattern as AH/Gall.

## robots.txt

`www.plus.nl/robots.txt` disallows crawler-y paths (search, checkout) but not the
`/screenservices/…` app endpoints the webshop itself calls. We stay gentle:
sequential requests, a short delay, a realistic desktop UA, no browser.
