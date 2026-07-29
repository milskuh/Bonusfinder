"use client";

import { useQuery } from "@tanstack/react-query";
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

export type OffersQuery = {
  sort?: OfferSort;
  page?: number;
  pageSize?: number;
  supermarkets?: string[];
  categories?: string[];
  discountMin?: number;
};

function toSearchParams(q: OffersQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.sort) sp.set("sort", q.sort);
  if (q.page) sp.set("page", String(q.page));
  if (q.pageSize) sp.set("pageSize", String(q.pageSize));
  if (q.supermarkets?.length) sp.set("supermarkets", q.supermarkets.join(","));
  if (q.categories?.length) sp.set("categories", q.categories.join(","));
  if (q.discountMin != null) sp.set("discountMin", String(q.discountMin));
  return sp;
}

async function fetchOffers(sp: URLSearchParams): Promise<OffersResponse> {
  const res = await fetch(`/api/offers?${sp.toString()}`);
  if (!res.ok) {
    throw new Error(`Kon aanbiedingen niet laden (${res.status})`);
  }
  return res.json();
}

export function useOffers(query: OffersQuery = {}) {
  const sp = toSearchParams(query);
  return useQuery({
    queryKey: ["offers", sp.toString()],
    queryFn: () => fetchOffers(sp),
    placeholderData: (prev) => prev, // keep previous page visible while paging
  });
}
