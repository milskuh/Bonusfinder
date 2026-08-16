// src/lib/queries/offers.ts
import { Prisma, Category } from "@prisma/client";
import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import type { OfferFilters, OfferSort } from "@/lib/validation/filters";
import { FOOD_CATEGORIES, NONFOOD_CATEGORIES } from "@/lib/categories";
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
  // Within a region this is still newest-first; but shoppers land expecting
  // groceries, so the "newest" feed is served in two regions — food/drink first,
  // then non-food — each ordered by this clause (see getOffersFromDb). The other
  // sorts use their orderBy directly, unpartitioned.
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

// The relations every feed card needs, defined once so the single-region path
// and the two-region "newest" path (food-first) return identically-shaped rows.
const offerInclude = {
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
} satisfies Prisma.OfferInclude;

type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

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
    // Bound the id set: a very broad term (e.g. a single common letter) could
    // otherwise match the whole catalogue and build a huge IN list. The cap is
    // far above any real filtered result (offers are then paginated anyway), so
    // it only clips pathological/abusive queries, not genuine searches.
    const matches = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Product" WHERE ${predicate} LIMIT 5000`,
    );
    where.productId = { in: matches.map((m) => m.id) };
  }

  const skip = (filters.page - 1) * filters.pageSize;
  const take = filters.pageSize;

  let total: number;
  let offers: OfferRow[];

  if (filters.sort === "newest") {
    // Food-first "newest": conceptually one list of all matching offers with the
    // food/drink ones (newest-first) ahead of the non-food ones (newest-first).
    // We serve that by treating the feed as two consecutive regions and slicing
    // the requested page across the boundary. Region membership just narrows the
    // existing `where` by category, so every other filter (store, price, search,
    // timeframe…) still applies unchanged and there's one source of truth for it.
    //
    // If the user has picked categories, intersect each region with that
    // selection — a food-only selection then degrades to a single region, and a
    // non-food-only selection to the other, both still correct.
    const foodCats = filters.categories
      ? filters.categories.filter((c) => FOOD_CATEGORIES.includes(c))
      : FOOD_CATEGORIES;
    const nonFoodCats = filters.categories
      ? filters.categories.filter((c) => NONFOOD_CATEGORIES.includes(c))
      : NONFOOD_CATEGORIES;

    // Restrict `where` to one region. `where.product` is a plain object literal we
    // built above, so spreading it and overriding `category` is safe; the region
    // list is already a subset of any user-selected categories.
    const regionWhere = (cats: Category[]): Prisma.OfferWhereInput => ({
      ...where,
      product: { ...(where.product as Prisma.ProductWhereInput), category: { in: cats } },
    });
    const foodWhere = regionWhere(foodCats);
    const nonFoodWhere = regionWhere(nonFoodCats);

    // Count the whole result (unchanged total → pageCount/infinite-scroll behave
    // as before) and the food region, which fixes where the boundary falls.
    // Kept in one transaction so the two counts see a consistent snapshot.
    const [fullTotal, foodTotal] = await db.$transaction([
      db.offer.count({ where }),
      db.offer.count({ where: foodWhere }),
    ]);
    total = fullTotal;

    // Split this page's [skip, skip+take) window across the food region
    // [0, foodTotal) and the non-food region that follows it.
    const foodSkip = Math.min(skip, foodTotal);
    const foodTake = Math.max(0, Math.min(take, foodTotal - skip));
    const nonFoodSkip = Math.max(0, skip - foodTotal);
    const nonFoodTake = take - foodTake;

    const [foodPage, nonFoodPage] = await Promise.all([
      foodTake > 0
        ? db.offer.findMany({
            where: foodWhere,
            orderBy: orderByMap.newest,
            skip: foodSkip,
            take: foodTake,
            include: offerInclude,
          })
        : Promise.resolve<OfferRow[]>([]),
      nonFoodTake > 0
        ? db.offer.findMany({
            where: nonFoodWhere,
            orderBy: orderByMap.newest,
            skip: nonFoodSkip,
            take: nonFoodTake,
            include: offerInclude,
          })
        : Promise.resolve<OfferRow[]>([]),
    ]);
    offers = [...foodPage, ...nonFoodPage];
  } else {
    const [fullTotal, rows] = await db.$transaction([
      db.offer.count({ where }),
      db.offer.findMany({
        where,
        orderBy: orderByMap[filters.sort],
        skip,
        take,
        include: offerInclude,
      }),
    ]);
    total = fullTotal;
    offers = rows;
  }

  // Beste deal = laagste pricePerUnit onder alle offers van dat product BINNEN
  // hetzelfde tijdvenster (dus niet beperkt tot de huidige pagina, en niet
  // vergeleken over 'deze week' vs 'volgende week' heen).
  // "Beste deal" marks the few biggest discounts in each category this week, so
  // the badge stays scarce and meaningful. The previous rule (cheapest per-unit
  // price for a product) sat on nearly every card, because almost every product
  // has a single weekly offer and is therefore trivially the cheapest offer of
  // itself. Instead we rank every timeframe offer by discount within its category
  // and take the top few — computed over ALL offers, not the filtered page, so the
  // badge means the same under any active filter. Ranking by (discount desc, id)
  // with a hard rn<=K cap bounds it to at most K per category even when many
  // offers share the same discount value.
  const BEST_DEALS_PER_CATEGORY = 3;
  const tf =
    filters.timeframe === "upcoming"
      ? Prisma.sql`o."validFrom" > ${now}`
      : Prisma.sql`o."validFrom" <= ${now} AND o."validUntil" >= ${now}`;
  const topRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM (
      SELECT o."id" AS id,
        ROW_NUMBER() OVER (
          PARTITION BY p."category" ORDER BY o."discountPercent" DESC, o."id"
        ) AS rn
      FROM "Offer" o
      JOIN "Product" p ON p."id" = o."productId"
      WHERE ${tf} AND o."discountPercent" IS NOT NULL
    ) ranked
    WHERE ranked.rn <= ${BEST_DEALS_PER_CATEGORY}
  `);
  const bestDealIds = new Set(topRows.map((r) => r.id));

  const items = offers.map((o) => ({
    ...o,
    isBestDeal: bestDealIds.has(o.id),
  }));

  return {
    items,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.ceil(total / filters.pageSize),
  };
}

export type OffersResult = Awaited<ReturnType<typeof getOffers>>;
