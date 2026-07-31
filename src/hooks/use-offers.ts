"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { OfferSort } from "@/lib/validation/filters";

// Shape of a single offer as serialized by GET /api/offers. Note: Prisma
// Decimal fields (salePrice, pricePerUnit, ...) arrive as strings over JSON.
export type OfferListItem = {
  id: string;
  productId: string;
  supermarketId: string;
  salePrice: string | null;
  originalPrice: string | null;
  discountPercent: number | null;
  offerText: string | null;
  pricePerUnit: string | null;
  pricePerUnitOf: string | null;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  isBestDeal: boolean;
  supermarket: { slug: string; name: string; logoUrl: string | null };
  product: {
    id: string;
    name: string;
    nameEn: string | null;
    brand: string | null;
    imageUrl: string | null;
    url: string | null;
    category: string;
    subcategory: string | null;
    contentAmount: string | null;
    contentUnit: string | null;
  };
};

export type OffersResponse = {
  items: OfferListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

// Filters that drive the query. `page` is intentionally absent — it's the
// infinite-query pageParam, not a caller-supplied filter (see useOffers).
export type OffersQuery = {
  q?: string;
  sort?: OfferSort;
  pageSize?: number;
  supermarkets?: string[];
  categories?: string[];
  discountMin?: number;
};

/** Serialize just the filters (no page) — this doubles as the query cache key. */
function toSearchParams(query: OffersQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.sort) sp.set("sort", query.sort);
  if (query.pageSize) sp.set("pageSize", String(query.pageSize));
  if (query.supermarkets?.length) sp.set("supermarkets", query.supermarkets.join(","));
  if (query.categories?.length) sp.set("categories", query.categories.join(","));
  if (query.discountMin != null) sp.set("discountMin", String(query.discountMin));
  return sp;
}

async function fetchOffers(query: OffersQuery, page: number): Promise<OffersResponse> {
  const sp = toSearchParams(query);
  sp.set("page", String(page));
  const res = await fetch(`/api/offers?${sp.toString()}`);
  if (!res.ok) {
    throw new Error(`Kon aanbiedingen niet laden (${res.status})`);
  }
  return res.json();
}

export function useOffers(query: OffersQuery = {}) {
  return useInfiniteQuery({
    // Key over all filters + sort (but NOT page): changing any filter yields a
    // new key, so the infinite query resets and refetches from page 1.
    queryKey: ["offers", toSearchParams(query).toString()],
    queryFn: ({ pageParam }) => fetchOffers(query, pageParam),
    initialPageParam: 1,
    // More pages remain while the last fetched page is below the total count.
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pageCount ? lastPage.page + 1 : undefined,
  });
}
