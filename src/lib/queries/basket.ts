// src/lib/queries/basket.ts
// Pure "cheapest basket" optimiser. Given a shopping list and the *active* offers
// for those products (fetched + active-filtered by the thin DB wrapper — this
// module never touches the database), it works out two ways to buy the list:
//
//   * multi-store  — each item at whichever store prices it cheapest, and
//   * single-store — the one store whose total for the items it can price is
//     lowest (with its coverage reported, since it may not carry everything).
//
// Correctness rules that shaped this file:
//   * Money is integer cents throughout — no floating-point euro drift. The
//     wrapper converts Prisma Decimal → cents; display code divides by 100.
//   * An offer with salePrice = null (e.g. "1+1 gratis", "25% korting") has no
//     usable numeric price: it never enters a total. Items with no usable price
//     at *any* store are surfaced in `needsAttention` (with their promo offerText
//     for the UI to translate), never counted as €0 and never dropped.
//   * Stores are derived entirely from the offer data — nothing is hardcoded, so
//     this scales to any number of supermarkets.
//
// Kept database-free and pure so the correctness-critical logic is unit-tested
// without a database (see basket.test.ts), mirroring offer-plan.ts.

/** A supermarket, as carried on each offer. */
export interface BasketStore {
  slug: string;
  name: string;
  logoUrl: string | null;
}

/** Product display metadata, passed straight through to the result for the UI. */
export interface BasketProduct {
  id: string;
  name: string;
  nameEn: string | null;
  brand: string | null;
  imageUrl: string | null;
}

/** One line on the shopping list. `quantity` is a positive integer. */
export interface BasketLine {
  productId: string;
  quantity: number;
  product: BasketProduct;
}

/**
 * One active offer for a basket product at a store. `salePriceCents` is null for
 * promos with no single usable price ("1+1 gratis"); `offerText` is the raw promo
 * label, shown (translated) on unpriced items.
 */
export interface BasketOffer {
  productId: string;
  supermarket: BasketStore;
  salePriceCents: number | null;
  offerText: string | null;
}

export interface MultiStoreLine {
  productId: string;
  product: BasketProduct;
  quantity: number;
  supermarket: BasketStore;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface StoreLine {
  productId: string;
  product: BasketProduct;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

/** A single supermarket's plan for the items it can price. */
export interface StorePlan {
  supermarket: BasketStore;
  totalCents: number;
  /** Items this store can price, out of the whole requested list. */
  coverage: { covered: number; total: number };
  lines: StoreLine[];
}

export type NeedsAttentionReason = "no-price" | "no-offer";

export interface NeedsAttentionItem {
  productId: string;
  product: BasketProduct;
  quantity: number;
  /** "no-offer": no active offer anywhere. "no-price": only price-less promos. */
  reason: NeedsAttentionReason;
  /** A representative promo label for "no-price" items (null for "no-offer"). */
  offerText: string | null;
  /** Every store with a price-less promo for this item (empty for "no-offer"). */
  promos: Array<{ supermarket: BasketStore; offerText: string | null }>;
}

export interface OptimizeBasketResult {
  multiStore: {
    lines: MultiStoreLine[];
    totalCents: number;
    /** Number of distinct stores the multi-store plan sends you to. */
    storeCount: number;
  };
  singleStore: {
    /** Lowest-total store (the "single-store cheapest"), or null if none price anything. */
    best: StorePlan | null;
    /** Every store that prices ≥1 item, cheapest total first. */
    perStore: StorePlan[];
  };
  savings: {
    /** Multi-store total vs the most expensive single-store total. */
    mostExpensiveStore: BasketStore | null;
    mostExpensiveTotalCents: number;
    /**
     * mostExpensiveTotal − multiStoreTotal. Can be ≤ 0 when no single store
     * covers the whole priced basket (multi-store then buys strictly more items
     * than any one store can). The UI only advertises a positive saving.
     */
    amountCents: number;
    /** Saving as a % of the most expensive single-store total, 1 decimal place. */
    percent: number;
  };
  needsAttention: NeedsAttentionItem[];
  /** Total requested lines. */
  itemCount: number;
  /** Lines with a usable price at ≥ 1 store. */
  pricedItemCount: number;
}

/** Per-store aggregate of one product's offers. */
interface StoreAgg {
  store: BasketStore;
  bestUnitCents: number | null;
  offerTexts: string[];
}

const bySlug = (a: BasketStore, b: BasketStore) => a.slug.localeCompare(b.slug);

/**
 * Compute the cheapest ways to buy `items`, given the already-active `offers` for
 * those products. Pure: no DB, no clock, no network.
 */
export function optimizeBasket(
  items: BasketLine[],
  offers: BasketOffer[],
): OptimizeBasketResult {
  // Index offers by product so each line only scans its own offers.
  const offersByProduct = new Map<string, BasketOffer[]>();
  for (const o of offers) {
    const list = offersByProduct.get(o.productId);
    if (list) list.push(o);
    else offersByProduct.set(o.productId, [o]);
  }

  const multiStoreLines: MultiStoreLine[] = [];
  const needsAttention: NeedsAttentionItem[] = [];
  // Accumulate each store's lines for the single-store plans, keyed by slug.
  const storeAcc = new Map<
    string,
    { store: BasketStore; lines: StoreLine[]; totalCents: number }
  >();
  let pricedItemCount = 0;

  for (const item of items) {
    const productOffers = offersByProduct.get(item.productId) ?? [];

    // Reduce this product's offers to one aggregate per store: the cheapest
    // usable price seen, plus any promo labels (kept for needs-attention).
    const aggByStore = new Map<string, StoreAgg>();
    for (const o of productOffers) {
      let agg = aggByStore.get(o.supermarket.slug);
      if (!agg) {
        agg = { store: o.supermarket, bestUnitCents: null, offerTexts: [] };
        aggByStore.set(o.supermarket.slug, agg);
      }
      if (o.salePriceCents != null) {
        agg.bestUnitCents =
          agg.bestUnitCents == null
            ? o.salePriceCents
            : Math.min(agg.bestUnitCents, o.salePriceCents);
      }
      if (o.offerText) agg.offerTexts.push(o.offerText);
    }

    const usable = [...aggByStore.values()].filter(
      (a): a is StoreAgg & { bestUnitCents: number } => a.bestUnitCents != null,
    );

    // No usable price anywhere → needs attention (never counted, never dropped).
    if (usable.length === 0) {
      if (productOffers.length === 0) {
        needsAttention.push({
          productId: item.productId,
          product: item.product,
          quantity: item.quantity,
          reason: "no-offer",
          offerText: null,
          promos: [],
        });
      } else {
        const promos = [...aggByStore.values()]
          .sort((a, b) => bySlug(a.store, b.store))
          .map((a) => ({ supermarket: a.store, offerText: a.offerTexts[0] ?? null }));
        const representative = promos.find((p) => p.offerText)?.offerText ?? null;
        needsAttention.push({
          productId: item.productId,
          product: item.product,
          quantity: item.quantity,
          reason: "no-price",
          offerText: representative,
          promos,
        });
      }
      continue;
    }

    pricedItemCount++;

    // Multi-store: the cheapest store for this item (tiebreak: slug ascending).
    const cheapest = usable.reduce((best, a) => {
      if (a.bestUnitCents < best.bestUnitCents) return a;
      if (a.bestUnitCents === best.bestUnitCents && bySlug(a.store, best.store) < 0) return a;
      return best;
    });
    multiStoreLines.push({
      productId: item.productId,
      product: item.product,
      quantity: item.quantity,
      supermarket: cheapest.store,
      unitPriceCents: cheapest.bestUnitCents,
      lineTotalCents: cheapest.bestUnitCents * item.quantity,
    });

    // Single-store: this item contributes to every store that can price it.
    for (const a of usable) {
      let acc = storeAcc.get(a.store.slug);
      if (!acc) {
        acc = { store: a.store, lines: [], totalCents: 0 };
        storeAcc.set(a.store.slug, acc);
      }
      const lineTotalCents = a.bestUnitCents * item.quantity;
      acc.lines.push({
        productId: item.productId,
        product: item.product,
        quantity: item.quantity,
        unitPriceCents: a.bestUnitCents,
        lineTotalCents,
      });
      acc.totalCents += lineTotalCents;
    }
  }

  const multiStoreTotalCents = multiStoreLines.reduce((s, l) => s + l.lineTotalCents, 0);
  const multiStoreSlugs = new Set(multiStoreLines.map((l) => l.supermarket.slug));

  // Store plans, cheapest total first (tiebreak: more coverage, then slug). With
  // this order perStore[0] is the single-store cheapest and the last is priciest.
  const perStore: StorePlan[] = [...storeAcc.values()]
    .map((p) => ({
      supermarket: p.store,
      totalCents: p.totalCents,
      coverage: { covered: p.lines.length, total: items.length },
      lines: p.lines,
    }))
    .sort(
      (a, b) =>
        a.totalCents - b.totalCents ||
        b.coverage.covered - a.coverage.covered ||
        bySlug(a.supermarket, b.supermarket),
    );

  const best = perStore.length > 0 ? perStore[0] : null;
  const mostExpensive = perStore.length > 0 ? perStore[perStore.length - 1] : null;
  const mostExpensiveTotalCents = mostExpensive?.totalCents ?? 0;
  const amountCents = mostExpensiveTotalCents - multiStoreTotalCents;
  const percent =
    mostExpensiveTotalCents > 0
      ? Math.round((amountCents / mostExpensiveTotalCents) * 1000) / 10
      : 0;

  return {
    multiStore: {
      lines: multiStoreLines,
      totalCents: multiStoreTotalCents,
      storeCount: multiStoreSlugs.size,
    },
    singleStore: { best, perStore },
    savings: {
      mostExpensiveStore: mostExpensive?.supermarket ?? null,
      mostExpensiveTotalCents,
      amountCents,
      percent,
    },
    needsAttention,
    itemCount: items.length,
    pricedItemCount,
  };
}
