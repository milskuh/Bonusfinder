// src/lib/queries/products.ts
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/validation/filters";

const activeOfferInclude = {
  where: { validUntil: { gte: new Date() } },
  orderBy: { pricePerUnit: "asc" },
  include: { supermarket: { select: { slug: true, name: true, logoUrl: true } } },
} as const;

export async function searchProducts({ q, page, pageSize }: SearchParams) {
  const offset = (page - 1) * pageSize;

  // websearch_to_tsquery pareert vrije gebruikersinput veilig (quotes, OR, -term).
  // $queryRaw parameteriseert ${...}, dus geen SQL-injectie.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p.id
    FROM "Product" p
    WHERE p."searchVector" @@ websearch_to_tsquery('dutch', ${q})
    ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('dutch', ${q})) DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

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
