// src/scrapers/offer-plan.ts
// Pure planning for how a fresh scrape maps onto the offers already in the DB.
// Kept database-free so the ingestion rule can be unit-tested without a database
// (see offer-plan.test.ts). persist.ts executes the plan this returns.
//
// Matching is scoped per (ISO week of validFrom, product): a re-scrape of one
// week only ever touches that week's rows. This lets a next-week ad — which some
// sources (e.g. Hoogvliet) publish days before it starts — coexist with the
// still-running current week instead of overwriting it.
//
// Within a week the rule is: a supermarket's offers are never removed by a
// re-scrape.
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
  /** Start of the validity window — offers are matched within the same ISO week. */
  validFrom: Date;
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
 * ISO-8601 week key ("2026-W32") for a date, computed from its local date parts.
 * Two offers whose validity starts in the same ISO week belong to the same weekly
 * ad; used to scope offer matching so re-scraping one week can't clobber another.
 */
export function isoWeekKey(date: Date): string {
  // Copy at local midnight, then shift to the Thursday of this ISO week — the day
  // that decides which ISO year/week the whole week belongs to (Mon=0 … Sun=6).
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const isoYear = d.getFullYear();
  // The Thursday of ISO week 1 is the Thursday in the week containing Jan 4.
  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  // round() absorbs the ±1h a DST change between the two dates could introduce.
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Decide, for one supermarket, which scraped offers update an existing row and
 * which are new — matching within the same (ISO week of validFrom, product). A
 * product can (rarely) carry several concurrent offers in a week, so existing
 * rows are held in a per-(week,product) queue and consumed one-to-one; anything
 * left in the queue is simply not touched (it stays until it expires). Scoping by
 * week means an early-published next-week ad and the current week never collide.
 *
 * `now` gates PriceHistory: a future-dated offer (validFrom > now, i.e. next
 * week's ad scraped early) is not an observed price yet, so it never contributes
 * a history point — that would pollute the "is this deal actually cheap" chart.
 */
export function buildOfferPlan(
  existing: ExistingOffer[],
  writes: OfferWrite[],
  now: Date,
): OfferPlan {
  const key = (productId: string, validFrom: Date) => `${isoWeekKey(validFrom)}::${productId}`;

  const pool = new Map<string, ExistingOffer[]>();
  for (const e of existing) {
    const k = key(e.productId, e.validFrom);
    const list = pool.get(k);
    if (list) list.push(e);
    else pool.set(k, [e]);
  }

  const updates: OfferPlan["updates"] = [];
  const creates: OfferWrite[] = [];
  const history: OfferPlan["history"] = [];

  for (const write of writes) {
    const match = pool.get(key(write.productId, write.data.validFrom))?.shift();
    const price = write.data.salePrice;
    // Only record history for offers whose window has actually started.
    const observed = write.data.validFrom.getTime() <= now.getTime();
    if (match) {
      updates.push({ id: match.id, data: write.data });
      const priceChanged =
        price != null &&
        (match.salePrice == null || Math.abs(match.salePrice - price) >= PRICE_EPSILON);
      if (priceChanged && observed) history.push({ productId: write.productId, price });
    } else {
      creates.push(write);
      if (price != null && observed) history.push({ productId: write.productId, price });
    }
  }

  return { updates, creates, history };
}
