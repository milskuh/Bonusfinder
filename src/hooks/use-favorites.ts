"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const IDS_KEY = ["favorites", "ids"] as const;
const LIST_KEY = ["favorites", "list"] as const;

// A favorited product with its cheapest active offer (as serialized by
// GET /api/favorites). Decimals arrive as strings over JSON.
export type FavoriteItem = {
  id: string;
  productId: string;
  createdAt: string;
  product: {
    id: string;
    name: string;
    nameEn: string | null;
    brand: string | null;
    imageUrl: string | null;
    category: string;
    subcategory: string | null;
    contentAmount: string | null;
    contentUnit: string | null;
    offers: Array<{
      id: string;
      salePrice: string | null;
      originalPrice: string | null;
      discountPercent: number | null;
      offerText: string | null;
      pricePerUnit: string | null;
      pricePerUnitOf: string | null;
      validUntil: string;
      supermarket: { slug: string; name: string; logoUrl: string | null };
    }>;
  };
};

async function fetchFavorites(): Promise<{ items: FavoriteItem[] }> {
  const res = await fetch("/api/favorites");
  if (res.status === 401) return { items: [] };
  if (!res.ok) throw new Error(`Kon favorieten niet laden (${res.status})`);
  return res.json();
}

async function fetchFavoriteIds(): Promise<string[]> {
  const { items } = await fetchFavorites();
  return items.map((f) => f.productId);
}

async function mutateFavorite(productId: string, add: boolean): Promise<void> {
  const res = await fetch("/api/favorites", {
    method: add ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
  if (!res.ok) throw new Error(`Favoriet bijwerken mislukt (${res.status})`);
}

/** Set of favorited productIds (only fetched when signed in). */
export function useFavoriteIds() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: IDS_KEY,
    queryFn: fetchFavoriteIds,
    enabled: !!isSignedIn,
    select: (ids) => new Set(ids),
  });
}

/** Full favorites list for the favorites page. */
export function useFavorites() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchFavorites,
    enabled: !!isSignedIn,
  });
}

/** Toggle a favorite with an optimistic update of the id set. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, add }: { productId: string; add: boolean }) =>
      mutateFavorite(productId, add),
    onMutate: async ({ productId, add }) => {
      await qc.cancelQueries({ queryKey: IDS_KEY });
      const prev = qc.getQueryData<string[]>(IDS_KEY);
      qc.setQueryData<string[]>(IDS_KEY, (old = []) =>
        add ? [...new Set([...old, productId])] : old.filter((id) => id !== productId),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(IDS_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });
}
