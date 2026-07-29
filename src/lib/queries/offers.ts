// src/lib/queries/offers.ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { OfferFilters } from "@/lib/validation/filters";

const orderByMap = {
  newest: { createdAt: "desc" },
  // discountPercent is nullable (deals like "1+1 gratis" have none) — keep those
  // out of the top of the "highest discount" sort.
  discount: { discountPercent: { sort: "desc", nulls: "last" } },
  price: { salePrice: { sort: "asc", nulls: "last" } },
  unitPrice: { pricePerUnit: { sort: "asc", nulls: "last" } },
} as const;

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function getOffers(filters: OfferFilters) {
  const now = new Date();

  const where: Prisma.OfferWhereInput = {
    validUntil: { gte: now }, // standaard: alleen actieve aanbiedingen
    ...(filters.supermarkets && {
      supermarket: { slug: { in: filters.supermarkets } },
    }),
    ...(filters.priceMin != null || filters.priceMax != null
      ? { salePrice: { gte: filters.priceMin, lte: filters.priceMax } }
      : {}),
    ...(filters.discountMin != null && {
      discountPercent: { gte: filters.discountMin },
    }),
    // "Loopt vandaag af" overschrijft de default validUntil met een venster.
    ...(filters.expiringToday && { validUntil: { gte: now, lte: endOfToday() } }),
    product: {
      ...(filters.categories && { category: { in: filters.categories } }),
      ...(filters.subcategories && { subcategory: { in: filters.subcategories } }),
      ...(filters.brands && { brand: { in: filters.brands } }),
    },
  };

  const [total, offers] = await db.$transaction([
    db.offer.count({ where }),
    db.offer.findMany({
      where,
      orderBy: orderByMap[filters.sort],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        supermarket: { select: { slug: true, name: true, logoUrl: true } },
        product: {
          select: {
            id: true,
            name: true,
            nameEn: true,
            brand: true,
            imageUrl: true,
            url: true,
            category: true,
            subcategory: true,
            contentAmount: true,
            contentUnit: true,
          },
        },
      },
    }),
  ]);

  // Beste deal = laagste pricePerUnit onder ALLE actieve offers van dat product
  // (dus niet beperkt tot de huidige pagina).
  const productIds = [...new Set(offers.map((o) => o.productId))];
  const mins = await db.offer.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, validUntil: { gte: now } },
    _min: { pricePerUnit: true },
  });
  const bestByProduct = new Map(mins.map((m) => [m.productId, m._min.pricePerUnit]));

  const items = offers.map((o) => {
    const best = bestByProduct.get(o.productId);
    return {
      ...o,
      isBestDeal: o.pricePerUnit != null && best != null && o.pricePerUnit.equals(best),
    };
  });

  return {
    items,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.ceil(total / filters.pageSize),
  };
}

export type OffersResult = Awaited<ReturnType<typeof getOffers>>;
