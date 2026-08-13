// src/scrapers/persist.ts
// Writes a scraper's `ScrapedOffer[]` into the database. Kept separate from the
// scrapers themselves so every source shares one consistent strategy:
//
//   * Supermarket  — upserted by slug.
//   * Product      — matched by a normalised key (productMatchKey) that folds away
//                    label noise across stores (diacritics, punctuation, word
//                    order, pack size), so the same article at different
//                    supermarkets collapses to one Product; created on first
//                    sight, else refreshed. (Matching lives in product-match.ts.)
//   * Offer        — updated in place, never wiped by a re-scrape, and matched
//                    per (supermarket, ISO week of validFrom) so scraping one week
//                    can't disturb another. This lets an early-published next-week
//                    ad coexist with the current week. New offers are inserted;
//                    offers that dropped out of the ad but are still within their
//                    validity window are left alone; an offer is only ever deleted
//                    once it is past its `validUntil`. (Matching lives in
//                    offer-plan.ts.)
//   * PriceHistory — a row is appended on first sighting or a price change, so the
//                    price chart keeps a trail without piling up identical points
//                    on every (e.g. daily) run.
import { CategorySource } from "@prisma/client";
import { db } from "../lib/db";
import { buildOfferPlan, type OfferWrite } from "./offer-plan";
import { productMatchKey } from "./product-match";
import type { ScrapedOffer, Scraper } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Only persist http(s) links. Deep-links and image URLs are third-party data
// scraped from supermarket sites; a `javascript:`/`data:` URL stored here would
// become a stored-XSS `href`/`src` in the UI (see offer-card.tsx). Anything that
// isn't a parseable http(s) URL collapses to null.
const safeHttpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const { protocol } = new URL(u);
    return protocol === "https:" || protocol === "http:" ? u : null;
  } catch {
    return null;
  }
};

export interface PersistResult {
  supermarket: string;
  /** New products created this run. */
  products: number;
  /** Offers written (created + updated). */
  offers: number;
  /** Offers inserted for the first time. */
  created: number;
  /** Existing active offers refreshed in place. */
  updated: number;
  /** Past-date offers removed. */
  expired: number;
}

export async function persistOffers(
  scraper: Pick<Scraper, "slug" | "name" | "logoUrl">,
  offers: ScrapedOffer[],
): Promise<PersistResult> {
  const now = new Date();

  // 1. Supermarket row. `logoUrl` is curated reference data owned by the seed
  //    (self-hosted /logos/* brand assets), so we only set it when first creating
  //    a store — never on update, or a re-scrape would overwrite the local logo
  //    with the scraper's generic fallback (e.g. a Clearbit URL).
  const market = await db.supermarket.upsert({
    where: { slug: scraper.slug },
    update: { name: scraper.name },
    create: { slug: scraper.slug, name: scraper.name, logoUrl: scraper.logoUrl ?? null },
  });

  // 2. Resolve products, creating any we haven't seen before. Pre-load the
  //    existing catalogue once to avoid a query per offer.
  const existing = await db.product.findMany({
    select: { id: true, name: true, brand: true, contentAmount: true, contentUnit: true },
  });
  // Build the match index from the SAME normaliser applied to stored products, so
  // an incoming offer and an existing product that denote the same article land
  // on the same key. contentAmount is a Prisma Decimal → plain number.
  const idByKey = new Map(
    existing.map((p) => [
      productMatchKey({
        name: p.name,
        brand: p.brand,
        contentAmount: p.contentAmount == null ? null : Number(p.contentAmount),
        contentUnit: p.contentUnit,
      }),
      p.id,
    ]),
  );

  // Manual category pins (see CategoryOverride). Loaded once and applied over the
  // scraper's computed category below, so a human correction survives every
  // re-scrape instead of being overwritten when the product reappears.
  const overrides = new Map(
    (await db.categoryOverride.findMany({ select: { productMatchKey: true, category: true } })).map(
      (o) => [o.productMatchKey, o.category] as const,
    ),
  );

  let created = 0;
  const resolved: { offer: ScrapedOffer; productId: string }[] = [];
  for (const offer of offers) {
    const key = productMatchKey({
      name: offer.name,
      brand: offer.brand,
      contentAmount: offer.contentAmount,
      contentUnit: offer.contentUnit,
    });
    // Precedence: a manual pin wins over the scraper's computed category; else use
    // what the scraper produced, recording how it was decided (`source` when the
    // scraper set it, otherwise the keyword `rule` default).
    const pinned = overrides.get(key);
    const category = pinned ?? offer.category;
    const categorySource = pinned
      ? CategorySource.manual
      : (offer.categorySource ?? CategorySource.rule);

    let productId = idByKey.get(key);
    if (!productId) {
      const product = await db.product.create({
        data: {
          name: offer.name,
          brand: offer.brand,
          category,
          categorySource,
          subcategory: offer.subcategory,
          imageUrl: safeHttpUrl(offer.imageUrl),
          url: safeHttpUrl(offer.deepLink),
          contentAmount: offer.contentAmount ?? null,
          contentUnit: offer.contentUnit ?? null,
        },
      });
      productId = product.id;
      idByKey.set(key, productId);
      created++;
    } else {
      // Keep category/image fresh — the source is the source of truth (except a
      // manual pin, applied above).
      await db.product.update({
        where: { id: productId },
        data: {
          category,
          categorySource,
          subcategory: offer.subcategory,
          // Validate when a value is supplied; leave the stored value untouched
          // when the source omitted it (undefined = "no change" in Prisma).
          imageUrl: offer.imageUrl ? safeHttpUrl(offer.imageUrl) : undefined,
          url: offer.deepLink ? safeHttpUrl(offer.deepLink) : undefined,
          contentAmount: offer.contentAmount ?? undefined,
          contentUnit: offer.contentUnit ?? undefined,
        },
      });
    }
    resolved.push({ offer, productId });
  }

  // 3. Load this supermarket's still-active offers and work out which scraped
  //    offers update them in place vs. are new (offer-plan.ts). Nothing here
  //    removes an active offer — that only happens in the delete below, and only
  //    once an offer is past its validUntil.
  const activeExisting = await db.offer.findMany({
    where: { supermarketId: market.id, validUntil: { gte: now } },
    select: { id: true, productId: true, salePrice: true, validFrom: true },
  });

  const writes: OfferWrite[] = resolved.map(({ offer, productId }) => {
    const salePrice = offer.salePrice != null ? round2(offer.salePrice) : null;
    const pricePerUnit =
      salePrice != null && offer.contentAmount && offer.contentAmount > 0
        ? round4(salePrice / offer.contentAmount)
        : null;
    return {
      productId,
      data: {
        salePrice,
        originalPrice: offer.originalPrice != null ? round2(offer.originalPrice) : null,
        discountPercent: offer.discountPercent != null ? Math.round(offer.discountPercent) : null,
        offerText: offer.offerText ?? null,
        pricePerUnit,
        pricePerUnitOf: pricePerUnit != null ? offer.contentUnit : null,
        validFrom: offer.validFrom,
        validUntil: offer.validUntil,
      },
    };
  });

  const plan = buildOfferPlan(
    activeExisting.map((o) => ({
      id: o.id,
      productId: o.productId,
      salePrice: o.salePrice == null ? null : Number(o.salePrice),
      validFrom: o.validFrom,
    })),
    writes,
    now,
  );

  // 4. Apply everything in one transaction so readers never see a half-updated
  //    ad: prune past-date offers, refresh the ones still running, insert the new
  //    ones, and append any price-history points.
  const [expired] = await db.$transaction([
    db.offer.deleteMany({
      where: { supermarketId: market.id, validUntil: { lt: now } },
    }),
    ...plan.updates.map((u) => db.offer.update({ where: { id: u.id }, data: u.data })),
    ...plan.creates.map((c) =>
      db.offer.create({ data: { productId: c.productId, supermarketId: market.id, ...c.data } }),
    ),
    ...plan.history.map((h) =>
      db.priceHistory.create({
        data: {
          productId: h.productId,
          supermarketId: market.id,
          price: h.price,
          isOffer: true,
          recordedAt: now,
        },
      }),
    ),
  ]);

  return {
    supermarket: scraper.slug,
    products: created,
    offers: plan.updates.length + plan.creates.length,
    created: plan.creates.length,
    updated: plan.updates.length,
    expired: expired.count,
  };
}
