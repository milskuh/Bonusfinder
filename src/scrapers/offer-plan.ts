// src/scrapers/offer-plan.ts
// Pure planning for how a fresh scrape maps onto the offers already in the DB.
// Kept database-free so the ingestion rule can be unit-tested without a database
// (see offer-plan.test.ts). persist.ts executes the plan this returns.
//
// The rule: a supermarket's *active* offers are never removed by a re-scrape.
//   * An offer still present in the ad     -> updated in place (same row).
//   * An offer new to the ad               -> inserted.
//   * An offer no longer in the ad but not
//     yet past its validUntil              -> left untouched (kept until it expires).
// Removing past-date offers is a separate step in persist.ts; this planner never
// deletes anything. That is what "only remove discounts when past the date" means.

/** An offer already in the DB that is still within its validity window. */
export interface ExistingOffer {
  id: string;
  productId: string;
  /** Current sale price in euros, or null for price-less promos ("1+1 gratis"). */
  salePrice: number | null;
}

/** The stored fields of one offer, already normalised (rounded) by persist.ts. */
export interface OfferData {
  salePrice: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  offerText: string | null;
  pricePerUnit: number | null;
  pricePerUnitOf: string | null;
  validFrom: Date;
  validUntil: Date;
}

/** One freshly scraped offer, resolved to its product, ready to write. */
export interface OfferWrite {
  productId: string;
  data: OfferData;
}

export interface OfferPlan {
  /** Existing rows to update in place (product still on offer). */
  updates: { id: string; data: OfferData }[];
  /** Brand-new offers to insert. */
  creates: OfferWrite[];
  /** Price points to append to PriceHistory: first sighting or a changed price. */
  history: { productId: string; price: number }[];
}

// Prices are 2-decimal euros; treat anything within half a cent as unchanged.
const PRICE_EPSILON = 0.005;

/**
 * Decide, for one supermarket, which scraped offers update an existing active
 * row and which are new — matching by product. A product can (rarely) carry
 * several concurrent offers, so existing rows are held in a per-product queue and
 * consumed one-to-one; anything left in the queue is simply not touched (it stays
 * until it expires).
 */
export function buildOfferPlan(existing: ExistingOffer[], writes: OfferWrite[]): OfferPlan {
  const pool = new Map<string, ExistingOffer[]>();
  for (const e of existing) {
    const list = pool.get(e.productId);
    if (list) list.push(e);
    else pool.set(e.productId, [e]);
  }

  const updates: OfferPlan["updates"] = [];
  const creates: OfferWrite[] = [];
  const history: OfferPlan["history"] = [];

  for (const write of writes) {
    const match = pool.get(write.productId)?.shift();
    const price = write.data.salePrice;
    if (match) {
      updates.push({ id: match.id, data: write.data });
      const priceChanged =
        price != null &&
        (match.salePrice == null || Math.abs(match.salePrice - price) >= PRICE_EPSILON);
      if (priceChanged) history.push({ productId: write.productId, price });
    } else {
      creates.push(write);
      if (price != null) history.push({ productId: write.productId, price });
    }
  }

  return { updates, creates, history };
}
