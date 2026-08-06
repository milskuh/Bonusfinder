"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OptimizeBasketResult } from "@/lib/queries/basket";

const IDS_KEY = ["basket", "ids"] as const;
const LIST_KEY = ["basket", "list"] as const;
const OPTIMIZE_KEY = ["basket", "optimize"] as const;

// A basket line as serialized by GET /api/basket. Pricing is intentionally NOT
// here — it comes from the optimize endpoint (useOptimizeBasket).
export type BasketListItem = {
  id: string;
  productId: string;
  quantity: number;
  createdAt: string;
  product: {
    id: string;
    name: string;
    nameEn: string | null;
    brand: string | null;
    imageUrl: string | null;
  };
};

async function fetchBasket(): Promise<{ items: BasketListItem[] }> {
  const res = await fetch("/api/basket");
  if (res.status === 401) return { items: [] };
  if (!res.ok) throw new Error(`Kon mandje niet laden (${res.status})`);
  return res.json();
}

async function fetchBasketIds(): Promise<string[]> {
  const { items } = await fetchBasket();
  return items.map((i) => i.productId);
}

async function optimizeBasketRequest(): Promise<OptimizeBasketResult> {
  const res = await fetch("/api/basket/optimize", { method: "POST" });
  if (!res.ok) throw new Error(`Kon mandje niet optimaliseren (${res.status})`);
  return res.json();
}

async function mutateBasket(
  method: "POST" | "PUT" | "DELETE",
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch("/api/basket", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mandje bijwerken mislukt (${res.status})`);
}

/** Set of productIds in the basket (only fetched when signed in). */
export function useBasketIds() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: IDS_KEY,
    queryFn: fetchBasketIds,
    enabled: !!isSignedIn,
    select: (ids) => new Set(ids),
  });
}

/** Full basket list for the basket page. */
export function useBasket() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchBasket,
    enabled: !!isSignedIn,
  });
}

/** The optimiser result for the current basket (refetched when the basket changes). */
export function useOptimizeBasket() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: OPTIMIZE_KEY,
    queryFn: optimizeBasketRequest,
    enabled: !!isSignedIn,
  });
}

/** Toggle a product in/out of the basket, with an optimistic id-set update. */
export function useToggleBasketItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, add }: { productId: string; add: boolean }) =>
      add ? mutateBasket("POST", { productId }) : mutateBasket("DELETE", { productId }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["basket"] }),
  });
}

/** Set a line's quantity, with an optimistic list update. */
export function useUpdateBasketQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      mutateBasket("PUT", { productId, quantity }),
    onMutate: async ({ productId, quantity }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<{ items: BasketListItem[] }>(LIST_KEY);
      qc.setQueryData<{ items: BasketListItem[] }>(LIST_KEY, (old) =>
        old
          ? { items: old.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)) }
          : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["basket"] }),
  });
}

/** Remove a line, with an optimistic update of both the list and the id set. */
export function useRemoveBasketItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => mutateBasket("DELETE", { productId }),
    onMutate: async (productId) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      await qc.cancelQueries({ queryKey: IDS_KEY });
      const prevList = qc.getQueryData<{ items: BasketListItem[] }>(LIST_KEY);
      const prevIds = qc.getQueryData<string[]>(IDS_KEY);
      qc.setQueryData<{ items: BasketListItem[] }>(LIST_KEY, (old) =>
        old ? { items: old.items.filter((i) => i.productId !== productId) } : old,
      );
      qc.setQueryData<string[]>(IDS_KEY, (old = []) => old.filter((id) => id !== productId));
      return { prevList, prevIds };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList) qc.setQueryData(LIST_KEY, ctx.prevList);
      if (ctx?.prevIds) qc.setQueryData(IDS_KEY, ctx.prevIds);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["basket"] }),
  });
}
