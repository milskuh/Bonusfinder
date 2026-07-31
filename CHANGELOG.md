# Changelog

All notable changes, grouped by feature in the order they were built, newest
session first. Dates are absolute.

---

## 2026-07-30 — Infinite scroll for the offers feed

Replaced the feed's **page-number pagination** with **infinite scroll**: offers
load progressively as you approach the bottom instead of clicking prev/next.
Almost entirely client-side — the response shape already carried
`{ items, total, page, pageSize, pageCount }` (everything the cursor logic
needs), and the **schema and scrapers are untouched**. The one server-side
change is a sort tiebreaker in the offers query, forced by a latent pagination
bug the feature exposed (see the fix below).

### TL;DR

- **Hook (`hooks/use-offers.ts`)** — `useQuery` → **`useInfiniteQuery`**. `page`
  leaves `OffersQuery` (it's now the `pageParam`); the query key is the
  serialized filters **minus page**, so changing any filter/sort cleanly resets
  the query to page 1. `getNextPageParam` advances while `page < pageCount`
  (derived from the real `total`) — a full last page still ends correctly, no
  fragile `items.length === pageSize` guess.
- **Feed (`components/offers/offers-feed.tsx`)** — dropped the prev/next pager;
  flattens `data.pages` into one grid; an `IntersectionObserver` sentinel
  (600 px `rootMargin`, disconnected on unmount) calls `fetchNextPage()` as it
  nears the viewport. A `Loader2` spinner shows while fetching and a subtle
  end-of-list marker once everything is loaded. Empty / error / initial-skeleton
  states unchanged.
- **i18n** — one new key `offers.end` ("Geen aanbiedingen meer" / "No more
  offers") in both locales; no hardcoded strings.

### Fix: filters showed the wrong products (offset pagination)

The real bug behind "category filters don't work": the feed sorted by
`createdAt DESC` only, but every offer from one ingest run shares a timestamp, so
`OFFSET`-based pages returned **overlapping rows** (page 1 ∩ page 2 = 14 offers).
Once flattened those duplicates became duplicate React `key`s, and when you then
picked a category React couldn't reconcile the shrunken list — it stranded the
old cards, so **"Vlees" showed coffee, tuna and yoghurt** while the count
correctly read 39. Fixed at the source with a **unique `id` tiebreaker on every
sort** (`lib/queries/offers.ts`) so pages can't overlap, plus a **de-dupe by id**
when flattening pages (`offers-feed.tsx`) as a guard against any residual overlap
from a concurrent ingest.

### Also: scroll resets to the top on filter change

Selecting a filter after scrolling deep otherwise left you stranded at the bottom
of the new (shorter) result set (and nudged the observer to auto-load). Now
scroll returns to the top whenever `query` / `sort` / `categories` change (first
mount skipped, to keep deep-link / back-navigation scroll).

---

## 2026-07-30 — Three new supermarkets (Jumbo, Aldi, Lidl)

Added scrapers for **Jumbo, Aldi and Lidl**, taking the aggregator from two
sources to **five** — **191 → 532** active offers (Hoogvliet 73 + AH 118, plus
Jumbo 65 + Aldi 190 + Lidl 86). Ingestion-only: the shared
pipeline (`categorize` / `normalize` / `persist`) and the schema are
**unchanged** — each store is a thin new adapter that flows through it. One
commit per store, each with pure/tested parsing helpers and a
`sources/<store>.discovery.md` recording the live inspection.

### TL;DR

- **Jumbo** (`sources/jumbo.ts`, 65 offers) — `jumbo.com/aanbiedingen/nu` is a
  Nuxt SSR app; the offers are inlined as a devalue payload
  (`<script id="__NUXT_DATA__">`). One GET + unflatten the payload. Promotion-
  centric like AH: deal in a text tag (`voor 1,99` → salePrice; `2 voor 6,00` →
  bundle; `1+1 gratis`/`% korting` → offerText only, no synthesized price).
- **Aldi** (`sources/aldi.ts`, 190 offers) — the folder is a graphical iPaper
  leaflet, but `aldi.nl/aanbiedingen.html` (Next.js) inlines a fully structured
  feed (`pageProps.apiData` → `OFFER_GET.algoliaDataMap`). Real was→now prices,
  so it goes through `normalize.ts` (like Hoogvliet); unit price recovered from
  Aldi's `basePrice`.
- **Lidl** (`sources/lidl.ts`, 86 offers) — **not** walled off as expected: a
  plain fetch of the offers page returns 200 and products are inlined as
  `data-grid-data="{…}"` tile attributes. Discover the rotating
  `/c/aanbiedingen/a<id>` URL from the homepage, parse the tiles. Real
  was→now prices via `normalize.ts`.
- **Branding + seed:** the three slugs were already seeded; added their brand
  colours to `lib/supermarkets.ts` (Jumbo yellow, Aldi #00b4dc, Lidl blue) and
  registered them in `run.ts`. Adds a `test` script (Node runner via `tsx`) and
  **26 scraper unit tests**.

### Gentle & permitted

All three are **plain HTTP, anonymous, robots-permitted**, and each pulls the
whole week in **1–2 requests** (the offer lists are server-inlined, no
pagination). No headless browser, no app/backend API, no OCR, and — notably for
Lidl — **no CAPTCHA/WAF/login was encountered or bypassed**. The brief's
"Lidl is walled off, use the backend API" premise was verified **outdated** and
is documented in `sources/lidl.discovery.md`.

### Honest pricing, unchanged rules

Multi-buy / percentage promos keep only `salePrice` + `offerText` with
`originalPrice`/`discountPercent` left null (Jumbo `1+1 gratis`, Aldi/AH
`N voor P`) — no synthesized price or percentage. Aldi and Lidl carry a real
strike-through price, so those flow through the **existing** `normalize.ts` for
the one canonical discount rule (and get `pricePerUnit`, so they compete for the
cross-store "beste deal" flag).

---

## 2026-07-30

Three **feed presentation + search** features on top of the aggregator. Web-app
only — no scraper, schema, or migration changes. Each shipped as its own commit.

### TL;DR

- **Per-store visual identity** — a brand-coloured accent bar + logo chip on every
  card, driven by one typed config; tells you the store at a glance and scales to
  new chains.
- **Product images** — `Product.imageUrl` shown in a fixed 4:3 box with a skeleton
  while loading and a graceful placeholder for missing/broken images (no layout
  shift).
- **Search bar** — debounced text search over product names, backed by the
  **existing** Postgres `tsvector`; composes with the category/sort/price filters
  and syncs to the URL.
- No new dependencies, no migrations. New files: `src/lib/supermarkets.ts` and the
  shadcn `input` primitive.

---

### 1. Per-store visual identity (`src/lib/supermarkets.ts`)

A typed, `slug`-keyed brand config (primary colour + readable foreground + short
badge), modelled on [categories.ts](src/lib/categories.ts), with a **neutral
fallback** so an unknown slug never crashes. Each
[OfferCard](src/components/offers/offer-card.tsx) now carries a brand-coloured
**left accent bar** + a **store chip** (logo on a white tile → falls back to the
badge / first initial when the logo is missing or fails to load). Adding
Jumbo/Lidl/Aldi later is a **single entry** in `supermarkets.ts`.

- Colours are centralised in the config (not hardcoded in components) and applied
  via inline style. AH = `#0071b9`, Hoogvliet = `#e2001a` — **approximations of the
  brand colours; tune against the real logos.**

### 2. Product images with fallback

- Photo in a fixed **4:3** box (`object-contain`) so cards stay uniform regardless
  of source dimensions; a **skeleton** shows while loading and the feed skeleton
  reserves the same space → no layout shift.
- **Fallback (required):** a null/empty `imageUrl` or a runtime `onError` → a
  neutral icon placeholder (bilingual `card.noImage` label), never a broken image.
- **Plain lazy `<img>`, not `next/image`:** product/logo hosts vary per source and
  can change (`static.ah.nl`, `www.hoogvliet.com`, `logo.clearbit.com`), so a
  `next/image` `remotePatterns` allowlist would be brittle; `<img loading="lazy">`
  + `onError` is robust and emits no console errors. `next.config.ts` untouched.

### 3. Search bar — Postgres full-text search

Reuses the existing trigger-maintained `Product.searchVector` (Dutch config, see
`prisma/fts_setup.sql`) — **not rebuilt.** Wired end-to-end:

- **`q`** added to the shared Zod schema in
  [filters.ts](src/lib/validation/filters.ts) (trimmed, max 100, optional);
  empty/absent behaves exactly as before (no filtering).
- [queries/offers.ts](src/lib/queries/offers.ts): a parameterized `$queryRaw` with
  `websearch_to_tsquery('dutch', …)` (same config as index-time) resolves matching
  product IDs, added as `productId: { in: [...] }` so `q` **composes** with the
  category/price/discount filters, sort and pagination rather than replacing them.
- [use-offers.ts](src/hooks/use-offers.ts): `q` is part of the query key → results
  cache per search term.
- [offers-feed.tsx](src/components/offers/offers-feed.tsx): a shadcn `Input` with a
  **300 ms debounce**, page reset on a new term, **URL sync** via
  `history.replaceState` (shareable + refresh-safe, no Suspense boundary needed), a
  clear (X) button, and a clear-search action in the empty state. Bilingual
  `search.placeholder` / `search.clear`.

The `/api/offers` handler already passes parsed filters straight to `getOffers`,
so no route change was needed.

### Files added

```
src/lib/supermarkets.ts        # per-store brand config (colour, foreground, badge)
src/components/ui/input.tsx    # shadcn input primitive
```

### Files changed

`src/components/offers/{offer-card,offers-feed}.tsx`,
`src/lib/{i18n,validation/filters,queries/offers}.ts`, `src/hooks/use-offers.ts`.

### Verified

`npx tsc --noEmit` and `npm run build` pass. Live smoke test against real data:
store recognisable at a glance (logo→badge fallback confirmed when the remote logo
failed), images load in a fixed box with placeholder + no layout shift, `"kip"`
narrows the feed 24→2 (incl. Dutch stemming on "Kips paté"), search composes with
the category filter, persists across a refresh via the URL, and toggles NL/EN
cleanly.

> **Note:** the repo has no ESLint config (`next lint` drops into interactive
> setup), so linting runs only as part of `next build` (clean) — there is no
> standalone `npm run lint` pass.

---

## 2026-07-29

Turned the project from a Next.js reader app with **fake demo data** into a
working aggregator that scrapes **two real supermarkets** (Hoogvliet + Albert
Heijn), with a fine-grained category filter and a Dutch/English UI.

### TL;DR

- **Scrapers built from scratch** for Hoogvliet (weekly folder) and Albert Heijn
  (Bonus API). ~73 + ~118 = **~191 real offers** in the DB.
- **All fake seed data removed** — the feed now shows only scraped data.
- **Category taxonomy** refined to fine-grained buckets and made **filterable in
  the GUI** (multi-select chips).
- **NL/EN language toggle** — full UI translation; product names via Claude.
- New DB columns, 5 migrations, 2 new npm scripts (`db:scrape`, `db:translate`).

---

### 1. Scraper framework (`src/scrapers/`)

A small, source-agnostic pipeline so each supermarket is just a thin adapter.

| File | Role |
|---|---|
| `types.ts` | `ScrapedOffer` / `Scraper` contract |
| `categorize.ts` | Dutch keyword → `Category` (word-start matching) |
| `normalize.ts` | Price → `discountPercent` rule (incl. multi-buy handling) |
| `persist.ts` | Upsert Supermarket/Product/Offer/PriceHistory in one transaction |
| `run.ts` | CLI: `npm run db:scrape [-- <slug>] [--dry]` |
| `sources/hoogvliet.ts` | Hoogvliet adapter |
| `sources/albert-heijn.ts` | Albert Heijn adapter |

**Commands**

```bash
npm run db:scrape                 # both supermarkets → DB
npm run db:scrape -- hoogvliet    # one source
npm run db:scrape -- ah --dry     # scrape + print summary, no DB writes
```

### 2. Hoogvliet scraper — via the weekly folder

Started against the webshop's Intershop `GetCategoriesForPromotionPage` endpoint
(Playwright + Incapsula), but it returned an **incomplete, non-deterministic**
subset (only "fresh" categories; the Cola/soda deals were missing). Pivoted to
the **digital folder**, which is the complete leaflet:

1. `www.hoogvliet.com/folder` → current folder id (`folder_2026_<week>`).
2. Publitas `folder.hoogvliet.com/<id>/page/<spread>/hotspots_data.json` → every
   deal's `/aanbiedingen/<articleId>` link (~73 deals).
3. Fetch each `/aanbiedingen/<id>` product page → parse with **cheerio**
   (name, original price, sale price, offer text, image, validity, deep link).

- **Plain `fetch` + cheerio — no browser.** Playwright was **removed**.
- **robots-friendly:** only touches allowed paths (`/aanbiedingen/<id>` + folder
  JSON); never the Disallowed `/INTERSHOP/`. Sequential, 1.5 s delay, realistic UA.
- A full run is ~3 min for ~73 deals.

### 3. Albert Heijn scraper — via the mobile Bonus API

`ah.nl/bonus` renders from AH's public app API, so we use that directly:

1. `POST api.ah.nl/mobile-auth/v1/auth/token/anonymous` → anonymous bearer token.
2. `GET mobile-services/bonuspage/v3/metadata` → current period + ~28 category
   sections. **Header `x-application: AHWEBSHOP` is required** (else HTTP 500).
3. `GET bonuspage/v2/section?...&category=<X>` per section → `bonusGroup` deals.

- **Promotion-centric:** discount is structured in `discountLabels`
  (`price` / `percentage`). ~40 % of deals ("25% korting", "1+1 gratis") have **no
  single euro price** → `Offer.salePrice` was made nullable (see migrations).
- Categorised by product name, falling back to AH's own section name when the
  name has no keyword (cut the generic `HOUDBAAR` bucket roughly in half).
- ~118 deals; ~48 with a price, ~25 with a discount %, all with offer text + image.

### 4. Removed all fake data

The original `prisma/seed.ts` inserted ~13 fake products + random offers and
**truncated the domain tables on every run**. Reworked:

- `seed.ts` now seeds **only supermarket reference rows** (real chains) and is
  **non-destructive** (no more `deleteMany`). It never creates fake products.
- Purged the pre-existing demo products/offers from the live DB.

> ⚠️ `npm run db:seed` is safe now but only seeds supermarket rows — real
> product data comes exclusively from `npm run db:scrape`.

### 5. Prices, discounts, deal text & deep links

`src/scrapers/normalize.ts` centralises the rule:

- `discountPercent = round((original − sale) / original × 100)` when
  `original > sale`, else `null`.
- **Multi-buy deals** ("1+1 gratis", "2e halve prijs", "N voor P") keep only
  `salePrice` + `offerText`; `originalPrice`/`discountPercent` stay empty (a
  synthetic % would mislead), even when the source shows a strikethrough.

The [OfferCard](src/components/offers/offer-card.tsx) shows the strikethrough
original + a `−X%` badge when present, otherwise an `offerText` badge; the product
name links to the deep link.

### 6. Category taxonomy — fine-grained + GUI filter

The enum was split in two passes and exposed as a filter:

- `VLEES_VIS` → `VLEES` + `VIS`; added `SODA` (soft drinks).
- `GROENTE_FRUIT` → `GROENTE` + `FRUIT`; split out `EIEREN` (from ZUIVEL) and
  `PASTA_RIJST` (from HOUDBAAR).
- **Categorizer bug fixed:** matching changed from substring to **word-start**,
  so "kip" still matches "kipfilet" but "ei" no longer matches "kl**ei**n".
- **GUI filter:** multi-select chips in [offers-feed.tsx](src/components/offers/offers-feed.tsx),
  wired through `useOffers` to the already-existing server-side category filter.
  Labels live in [categories.ts](src/lib/categories.ts).

### 7. English translations (NL/EN toggle)

- **UI + deal text — client-side, no API key.** [i18n.ts](src/lib/i18n.ts) holds
  the NL/EN dictionary + `t()`, locale dates, and a **rule-based deal-text
  translator** ("1+1 gratis"→"1+1 free", "2 VOOR 4.99"→"2 for 4.99", "25%
  korting"→"25% off"). [language-provider.tsx](src/components/language-provider.tsx)
  is the context + toggle, persisted to `localStorage`. Category labels are
  bilingual.
- **Product names — via Claude.** New `Product.nameEn`; the UI shows it in EN
  mode and **falls back to the Dutch name when empty** (nothing breaks without a
  key). Populated by `npm run db:translate` ([translate.ts](src/scrapers/translate.ts),
  model `claude-opus-5`, batched, idempotent).

```bash
npm run db:translate   # fills Product.nameEn for untranslated products
```

> Requires `ANTHROPIC_API_KEY` in `.env` (see `.env.example`). Without it the
> command exits with a clear message; the site still works (English UI + Dutch
> product names).

---

### Database migrations (apply with `npx prisma migrate deploy`)

| Migration | Change |
|---|---|
| `20260729120000_split_categories` | `VLEES_VIS`→`VLEES`+`VIS`; add `SODA` |
| `20260729130000_offer_text_and_deeplink` | add `Offer.offerText`, `Product.url`; `Offer.discountPercent` → nullable |
| `20260729140000_nullable_saleprice` | `Offer.salePrice` → nullable |
| `20260729150000_split_groente_fruit_eieren_pasta` | `GROENTE_FRUIT`→`GROENTE`+`FRUIT`; add `EIEREN`, `PASTA_RIJST` |
| `20260729160000_product_name_en` | add `Product.nameEn` |

### Schema changes

- **Category enum** (final): `GROENTE, FRUIT, VLEES, VIS, ZUIVEL, EIEREN, KAAS,
  BROOD_BANKET, DRANKEN, SODA, PASTA_RIJST, SNACKS_SNOEP, DIEPVRIES, HOUDBAAR,
  ONTBIJT, DROGISTERIJ, HUISHOUDEN, BABY_KIND, HUISDIER`.
- **Product:** `+ nameEn String?`, `+ url String?`.
- **Offer:** `+ offerText String?`, `salePrice` and `discountPercent` now nullable.

### Dependencies

- **Added:** `cheerio` (HTML parsing), `@anthropic-ai/sdk` (translation).
- **Removed:** `playwright` (folder scraper uses plain `fetch`).

### npm scripts

- **Added:** `db:scrape`, `db:translate`.

### Files added

```
src/scrapers/{types,categorize,normalize,persist,run,translate,translate-run}.ts
src/scrapers/sources/{hoogvliet,albert-heijn}.ts
src/lib/{categories,i18n}.ts
src/components/{language-provider,header-nav}.tsx
.claude/launch.json            # dev-server launch config for the preview browser
prisma/migrations/2026072912…-2026072916…    # 5 migrations
```

### Files changed (highlights)

`prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/queries/offers.ts`,
`src/hooks/{use-offers,use-favorites}.ts`,
`src/components/offers/{offer-card,offers-feed,favorite-button}.tsx`,
`src/app/{layout.tsx,providers.tsx,favorites/page.tsx}`,
`package.json`, `.env.example`.

---

### Current data state

- **~191 active offers**: ~73 Hoogvliet + ~118 Albert Heijn (varies per week;
  numbers dip during the weekly folder rollover).
- No fake/demo product data.

### To reproduce a fresh run

```bash
npx prisma migrate deploy      # apply all migrations
npm run db:fts                 # (re)build the Dutch full-text search
npm run db:seed                # supermarket reference rows only
npm run db:scrape              # real offers (Hoogvliet + AH)
npm run db:translate           # optional: English product names (needs ANTHROPIC_API_KEY)
npm run dev
```

### Known caveats

- Category assignment is **best-effort** keyword matching; odd items land in
  `HOUDBAAR` or the occasional wrong bucket (e.g. "Eierkoeken" → `EIEREN`). Add a
  keyword in `categorize.ts` to correct one.
- The scrapers use endpoints under Hoogvliet's `/INTERSHOP/`-adjacent hosts and
  AH's app API; both are gentle (throttled, realistic UA) but are unofficial and
  can change if the sites change.
- The installed `@anthropic-ai/sdk` predates the typed `output_config`
  (structured outputs), so `translate.ts` uses plain JSON prompting + validation.
- The Clerk auth keys in `.env` were logging a key-mismatch warning (pre-existing,
  unrelated to this work).
