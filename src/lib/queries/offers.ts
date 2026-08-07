// src/lib/queries/offers.ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import type { OfferFilters, OfferSort } from "@/lib/validation/filters";
import { timeframeWhere } from "./timeframe";
import { toPrefixTsQuery, likeEscape } from "./search";

// How long a computed feed page stays served from the in-process cache. Offers
// only change on an ingest run, so this is comfortably within the CDN's
// s-maxage=300 on /api/offers; it mainly coalesces concurrent identical requests
// and keeps hot filter combos off the single pooled DB connection.
const OFFERS_TTL_MS = 120_000;

// Stable cache key: sort array-valued filters so equivalent requests in any order
// hit the same entry.
function offersCacheKey(f: OfferFilters): string {
  const sortArr = (a?: string[]) => (a ? [...a].sort() : undefined);
  return JSON.stringify({
    q: f.q,
    supermarkets: sortArr(f.supermarkets),
    categories: sortArr(f.categories),
    subcategories: sortArr(f.subcategories),
    brands: sortArr(f.brands),
    priceMin: f.priceMin,
    priceMax: f.priceMax,
    discountMin: f.discountMin,
    expiringToday: f.expiringToday,
    timeframe: f.timeframe,
    sort: f.sort,
    page: f.page,
    pageSize: f.pageSize,
  });
}

// The active-offer predicate: an offer is active while `now` is on or before its
// validUntil. Exported so other queries (e.g. the basket optimiser) filter by the
// exact same rule instead of re-implementing it. NB: the offer *feed* uses
// timeframeWhere (which also gates validFrom) so it can show this week vs. next
// week; this looser rule stays for the basket/favourites, whose behaviour is
// unchanged for now.
export const activeOfferWhere = (now: Date): Prisma.OfferWhereInput => ({
  validUntil: { gte: now },
});

// Every sort ends with a unique `id` tiebreaker. Without it, offset pagination
// (skip/take) over rows that share a sort value is non-deterministic: many
// offers carry the same createdAt (one ingest run), so consecutive pages could
// return overlapping rows → duplicate ids on the client → a corrupted infinite
// feed. The id tiebreaker gives each sort a total order, so pages never overlap.
const orderByMap: Record<OfferSort, Prisma.OfferOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "asc" }],
  // discountPercent is nullable (deals like "1+1 gratis" have none) — keep those
  // out of the top of the "highest discount" sort.
  discount: [{ discountPercent: { sort: "desc", nulls: "last" } }, { id: "asc" }],
  price: [{ salePrice: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  unitPrice: [{ pricePerUnit: { sort: "asc", nulls: "last" } }, { id: "asc" }],
};

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function getOffers(filters: OfferFilters) {
  // Coalesce concurrent identical requests into one DB round-trip and serve hot
  // combos from memory for OFFERS_TTL_MS. See lib/cache.ts for the rationale.
  return cached(offersCacheKey(filters), OFFERS_TTL_MS, () => getOffersFromDb(filters));
}

async function getOffersFromDb(filters: OfferFilters) {
  const now = new Date();

  const where: Prisma.OfferWhereInput = {
    // Timeframe: 'current' (default, unchanged feed behaviour) of 'upcoming'
    // (volgende week — nog niet gestarte aanbiedingen). Zie lib/queries/timeframe.
    ...timeframeWhere(filters.timeframe, now),
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

  // Vrije-tekst zoekopdracht: match via de trigger-onderhouden tsvector
  // (Product.searchVector, Dutch config — dezelfde als prisma/fts_setup.sql, dus
  // query-tijd en index-tijd komen overeen). Prisma's ingebouwde `search` mikt
  // niet op deze custom kolom, dus we halen de matchende product-IDs op met een
  // geparametriseerde raw query en voegen ze toe als extra filter. Zo COMBINEERT
  // `q` met de bestaande categorie-/prijs-/kortingfilters, sortering en paginatie
  // (geen vervanging). Geen match => lege set => lege feed.
  //
  // We gebruiken een prefix-tsquery (to_tsquery('dutch', 'chocola:*')) i.p.v.
  // websearch_/plainto_ zodat deelwoorden ("chocola" → "Chocolade") matchen. Als
  // extra vangnet OR-en we een ILIKE substring-match op name/nameEn/brand: dat
  // dekt EN-modus (searchVector bevat alleen de NL naam/brand) en mid-woord hits.
  if (filters.q) {
    const tsq = toPrefixTsQuery(filters.q);
    const like = `%${likeEscape(filters.q)}%`;
    const predicate = tsq
      ? Prisma.sql`(
          "searchVector" @@ to_tsquery('dutch', ${tsq})
          OR "name" ILIKE ${like}
          OR "nameEn" ILIKE ${like}
          OR "brand" ILIKE ${like}
        )`
      : // Input viel volledig weg tot niets (alleen leestekens): alleen ILIKE.
        Prisma.sql`(
          "name" ILIKE ${like}
          OR "nameEn" ILIKE ${like}
          OR "brand" ILIKE ${like}
        )`;
    const matches = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Product" WHERE ${predicate}`,
    );
    where.productId = { in: matches.map((m) => m.id) };
  }

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

  // Beste deal = laagste pricePerUnit onder alle offers van dat product BINNEN
  // hetzelfde tijdvenster (dus niet beperkt tot de huidige pagina, en niet
  // vergeleken over 'deze week' vs 'volgende week' heen).
  const productIds = [...new Set(offers.map((o) => o.productId))];
  const mins = await db.offer.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, ...timeframeWhere(filters.timeframe, now) },
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
