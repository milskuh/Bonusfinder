// src/lib/queries/basket-optimize.ts
// Thin DB wrapper around the pure optimizeBasket(): loads the user's basket and
// the *currently valid* offers for those products (reusing the feed's exact
// current-timeframe predicate — not a re-implementation), converts Decimal euros
// to integer cents, and hands plain data to the pure optimiser. All DB access
// lives here; none in basket.ts, so the optimiser stays unit-testable without a
// database.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { timeframeWhere } from "./timeframe";
import { optimizeBasket, type BasketLine, type BasketOffer } from "./basket";

/** Prisma Decimal euros → integer cents (avoids floating-point euro drift). */
const toCents = (d: Prisma.Decimal | null): number | null =>
  d == null ? null : Math.round(Number(d) * 100);

/** Optimise the signed-in user's stored basket against currently active offers. */
export async function optimizeUserBasket(userId: string, now: Date = new Date()) {
  const items = await db.basketItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      product: {
        select: { id: true, name: true, nameEn: true, brand: true, imageUrl: true },
      },
    },
  });

  const productIds = items.map((i) => i.productId);
  // Currently valid offers for exactly the basket's products, grouped (in the
  // pure fn) by product + supermarket. Includes price-less promos so they can be
  // surfaced. Uses the "current" timeframe predicate (validFrom <= now AND
  // validUntil >= now) so next-week offers already ingested into the DB are not
  // priced as things you can buy right now.
  const offers = productIds.length
    ? await db.offer.findMany({
        where: { productId: { in: productIds }, ...timeframeWhere("current", now) },
        select: {
          productId: true,
          salePrice: true,
          offerText: true,
          supermarket: { select: { slug: true, name: true, logoUrl: true } },
        },
      })
    : [];

  const lines: BasketLine[] = items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    product: i.product,
  }));

  const shaped: BasketOffer[] = offers.map((o) => ({
    productId: o.productId,
    supermarket: o.supermarket,
    salePriceCents: toCents(o.salePrice),
    offerText: o.offerText,
  }));

  return optimizeBasket(lines, shaped);
}
