// src/lib/queries/products.ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/validation/filters";
import { toPrefixTsQuery, likeEscape } from "./search";

const activeOfferInclude = {
  where: { validUntil: { gte: new Date() } },
  orderBy: { pricePerUnit: "asc" },
  include: { supermarket: { select: { slug: true, name: true, logoUrl: true } } },
} as const;

export async function searchProducts({ q, page, pageSize }: SearchParams) {
  const offset = (page - 1) * pageSize;

  // Prefix-tsquery (to_tsquery('dutch', 'chocola:*')) zodat deelwoorden matchen,
  // met dezelfde ILIKE-vangnet als de offer-feed voor EN-namen/mid-woord hits.
  // toPrefixTsQuery stript alle tsquery-operators, dus geen injectie/syntax-error.
  // $queryRaw parameteriseert ${...}, dus geen SQL-injectie. FTS-treffers ranken
  // via ts_rank bovenaan; pure ILIKE-treffers hebben rank 0 en volgen daarna.
  const tsq = toPrefixTsQuery(q);
  const like = `%${likeEscape(q)}%`;
  const rank = tsq
    ? Prisma.sql`ts_rank(p."searchVector", to_tsquery('dutch', ${tsq}))`
    : Prisma.sql`0`;
  const predicate = tsq
    ? Prisma.sql`(
        p."searchVector" @@ to_tsquery('dutch', ${tsq})
        OR p."name" ILIKE ${like}
        OR p."nameEn" ILIKE ${like}
        OR p."brand" ILIKE ${like}
      )`
    : Prisma.sql`(
        p."name" ILIKE ${like}
        OR p."nameEn" ILIKE ${like}
        OR p."brand" ILIKE ${like}
      )`;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id
    FROM "Product" p
    WHERE ${predicate}
    ORDER BY ${rank} DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { items: [], page, pageSize };

  const products = await db.product.findMany({
    where: { id: { in: ids } },
    include: { offers: { ...activeOfferInclude, take: 1 } }, // goedkoopste actieve offer
  });

  // Herstel de relevantie-volgorde uit de FTS-query.
  const order = new Map(ids.map((id, i) => [id, i]));
  products.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  return { items: products, page, pageSize };
}

export async function getProductById(id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      offers: activeOfferInclude, // alle actieve offers, goedkoopste eerst
      priceHistory: {
        orderBy: { recordedAt: "asc" },
        take: 365,
        select: { price: true, recordedAt: true, supermarketId: true, isOffer: true },
      },
    },
  });
  if (!product) return null;

  return { ...product, bestOffer: product.offers[0] ?? null };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductById>>>;
