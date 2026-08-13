# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a Dutch household grocery shopper planning a shopping trip, frequently
on mobile. They open the site to see this week's supermarket "bonus" deals, filter to
what's relevant (category, store, search term), and decide where and what to buy before
going out. Secondary behaviour: a price-conscious deal-hunter who tracks favourites week
to week and assembles the cheapest cross-store basket.

## Product Purpose

Bonusfinder aggregates the weekly discount ("bonus"/"aanbieding") offers from many Dutch
supermarket chains into one searchable, filterable feed so a shopper can compare deals
across stores in one place instead of opening ten separate folders/apps. Success = the
shopper quickly finds the relevant deals and knows where to buy for the lowest spend.

## Positioning

Cross-store aggregation with normalized offers: deals from ~10 chains scraped, categorized
into a shared taxonomy, price-normalized (including multi-buy normalization), and made
searchable/filterable in a single feed — plus an honest cheapest-basket optimizer that
prices a shopping list across stores. A single-chain app cannot offer the cross-store
comparison; a generic folder viewer cannot offer normalized categories, search, or basket
optimization.

## Operating Context

- Weekly cadence: offers are valid for a defined timeframe (typically a week; some chains
  weekend-only or multi-week). A "this week" freshness gate and nightly re-scrape (02:00
  Amsterdam) keep the feed current.
- Mobile-first usage while planning or in-store; also desktop browsing.
- Bilingual audience: Dutch primary, English toggle available.

## Capabilities and Constraints

- Surfaces: offers feed (home), favourites, basket (cheapest-basket optimizer). Header nav,
  site footer, cookie-consent banner.
- Feed: filter by category (shared taxonomy incl. GROENTE/FRUIT/VLEES/VIS/ZUIVEL/KAAS/
  BROOD/DRANKEN/ALCOHOL/KOFFIE/VEGETARISCH/… + OVERIG catch-all), filter by store, full-text
  search (name+brand), category chips, store filter (desktop aside + mobile disclosure).
- Deals normalized: salePrice/discountPercent may be nullable (promotion-centric chains);
  savings calculations never fabricate a saving.
- Favourites and basket persist (signed-in via Clerk; cart also client localStorage).
- i18n: client-side UI dictionary + rule-based deal-text translation; product names via
  a translation job (Product.nameEn with Dutch fallback).
- Accessibility & QA: prior QA/a11y and security passes done; keep FTS name+brand only.
- Stack (existing): Next.js 15 (App Router), React 19, Tailwind v4, Clerk auth,
  Prisma + Supabase (Postgres), TanStack Query, lucide-react icons. Deployed on Vercel
  at bonusfinder.nu.

## Brand Commitments

- Visible brand name is **Bonusfinder** (via `src/lib/config.ts` APP_NAME). The repo folder
  / internal name "Aanbiedingscraper" is intentionally kept internal — not a user-facing name.
- Brand color tokens exist (`--color-brand` in globals `@theme`); logo/favicons via App Router
  conventions. Supermarket brand hex colors (supermarkets.ts) are the real chains' colors and
  must not be rebranded.
- Voice: practical, Dutch-first, trustworthy about prices (never overstate savings).

## Evidence on Hand

- Live production site: bonusfinder.nu (real scraped offers from ~10 chains).
- Real supermarket logos/brand colors in `src/lib/supermarkets.ts`.
- No testimonials, customer counts, press, or pricing/subscription claims exist — future
  work must not fabricate any.

## Product Principles

1. Honesty about money: never show a saving or "cheapest" claim that isn't real.
2. Cross-store comparison is the core value; keep offers scannable and comparable at a glance.
3. Mobile-first density: the planning shopper is often on a phone; respect the fold and speed.
4. Dutch-first, English-available; keep both languages first-class.
5. Weekly freshness: the feed must read as current-week and trustworthy about validity.
