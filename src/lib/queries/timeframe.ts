// src/lib/queries/timeframe.ts
// The date predicate behind the feed's "This week / Next week" toggle. Kept in a
// tiny, database-free module (like offer-plan.ts vs persist.ts) so the branch is
// unit-tested without a database — see timeframe.test.ts. getOffers spreads the
// result into its Prisma where-clause.
import type { Prisma } from "@prisma/client";
import type { Timeframe } from "../validation/filters";

/**
 * Offers matching `timeframe` relative to `now`:
 *
 *   * "current"  — the window has started and not yet ended
 *                  (validFrom <= now AND validUntil >= now). This also keeps
 *                  not-yet-started offers (a next-week ad a source published
 *                  early) OUT of the current feed, which the bare validUntil
 *                  check used previously did not.
 *   * "upcoming" — the window has not started yet (validFrom > now).
 *
 * The two are disjoint at any instant, so the same offer is never in both tabs.
 */
export function timeframeWhere(timeframe: Timeframe, now: Date): Prisma.OfferWhereInput {
  return timeframe === "upcoming"
    ? { validFrom: { gt: now } }
    : { validFrom: { lte: now }, validUntil: { gte: now } };
}
