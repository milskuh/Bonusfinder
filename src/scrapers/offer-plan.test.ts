// Unit tests for the offer ingestion planner. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOfferPlan, isoWeekKey, type ExistingOffer, type OfferWrite } from "./offer-plan";

// Two adjacent weekly ads. WK31 is the current week; WK32 is next week's ad, which
// a source may publish (with a future validFrom) before the current one ends.
const WK31 = { validFrom: new Date("2026-07-27"), validUntil: new Date("2026-08-02") };
const WK32 = { validFrom: new Date("2026-08-03"), validUntil: new Date("2026-08-09") };
// "Now" sits inside WK31, so WK31 offers are observed and WK32 offers are future.
const NOW = new Date("2026-07-30");

/** Terse OfferWrite builder — only price varies across most cases (defaults WK31). */
function write(productId: string, salePrice: number | null, win = WK31): OfferWrite {
  return {
    productId,
    data: {
      salePrice,
      originalPrice: null,
      discountPercent: null,
      offerText: null,
      pricePerUnit: null,
      pricePerUnitOf: null,
      ...win,
    },
  };
}

/** Terse ExistingOffer builder (defaults to the current week). */
function existing(
  id: string,
  productId: string,
  salePrice: number | null,
  validFrom = WK31.validFrom,
): ExistingOffer {
  return { id, productId, salePrice, validFrom };
}

test("first ever scrape: everything is a create, with a history point per priced offer", () => {
  const plan = buildOfferPlan([], [write("p1", 1.99), write("p2", null)], NOW);

  assert.equal(plan.updates.length, 0);
  assert.deepEqual(
    plan.creates.map((c) => c.productId),
    ["p1", "p2"],
  );
  // p2 has no price, so no history point for it.
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.99 }]);
});

test("re-scraping the same offer updates the existing row in place — no duplicate insert", () => {
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 1.99)], NOW);

  assert.deepEqual(plan.creates, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "o1");
  // Same price -> no new history point (avoids piling up identical points daily).
  assert.deepEqual(plan.history, []);
});

test("a price change on an existing offer updates in place and records the new price", () => {
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 1.49)], NOW);

  assert.equal(plan.updates[0].id, "o1");
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.49 }]);
});

test("a sub-cent price difference is treated as unchanged", () => {
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 1.991)], NOW);

  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.history, []);
});

test("gaining a price where there was none is recorded", () => {
  const plan = buildOfferPlan([existing("o1", "p1", null)], [write("p1", 2.5)], NOW);

  assert.deepEqual(plan.history, [{ productId: "p1", price: 2.5 }]);
});

test("an active offer that dropped out of the ad is left untouched (no update, no delete)", () => {
  // p1 is still on offer, p2 was active last week but is gone from this scrape.
  const plan = buildOfferPlan(
    [existing("o1", "p1", 1.99), existing("o2", "p2", 0.99)],
    [write("p1", 1.99)],
    NOW,
  );

  // Only p1 is updated; nothing references o2 — the planner never deletes, so o2
  // survives until it is pruned for being past its validUntil (in persist.ts).
  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.deepEqual(plan.creates, []);
});

test("mix of continuing and brand-new offers", () => {
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 1.99), write("p2", 3.49)], NOW);

  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.deepEqual(
    plan.creates.map((c) => c.productId),
    ["p2"],
  );
});

test("two concurrent offers for one product consume both existing rows one-to-one", () => {
  const plan = buildOfferPlan(
    [existing("o1", "p1", 1.99), existing("o2", "p1", 2.49)],
    [write("p1", 1.99), write("p1", 2.49)],
    NOW,
  );

  // Both map onto existing rows — no accumulation of duplicates across runs.
  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1", "o2"],
  );
  assert.deepEqual(plan.creates, []);
});

test("more scraped offers than existing rows for a product: overflow becomes a create", () => {
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 1.99), write("p1", 2.49)], NOW);

  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].data.salePrice, 2.49);
});

// --- Period scoping: this week vs. next week coexist -------------------------

test("isoWeekKey groups by ISO-8601 week and handles the year boundary", () => {
  assert.equal(isoWeekKey(new Date("2026-07-27")), "2026-W31"); // Mon of wk31
  assert.equal(isoWeekKey(new Date("2026-08-02")), "2026-W31"); // Sun of wk31
  assert.equal(isoWeekKey(new Date("2026-08-03")), "2026-W32"); // Mon of wk32
  assert.equal(isoWeekKey(new Date("2026-01-01")), "2026-W01"); // Thu → week 1
  assert.equal(isoWeekKey(new Date("2025-12-29")), "2026-W01"); // Mon rolls into 2026
});

test("a next-week offer for a product with a current-week row is a create, not an update", () => {
  // Same product, different ISO week → the current-week row is NOT overwritten.
  const plan = buildOfferPlan([existing("o1", "p1", 1.99)], [write("p1", 2.49, WK32)], NOW);

  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].data.salePrice, 2.49);
  // Future-dated (validFrom > now) → not an observed price → no history.
  assert.deepEqual(plan.history, []);
});

test("re-scraping only the current week leaves an already-stored next-week row untouched", () => {
  const plan = buildOfferPlan(
    [existing("o1", "p1", 1.99), existing("o2", "p1", 2.49, WK32.validFrom)],
    [write("p1", 1.79)],
    NOW,
  );

  // o1 (current week) updated; o2 (next week) has no matching write → left alone.
  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.79 }]);
});

test("scraping both weeks at once: current updates in place, next week inserts, history only for the started week", () => {
  const plan = buildOfferPlan(
    [existing("o1", "p1", 1.99)],
    [write("p1", 1.49), write("p1", 3.0, WK32)],
    NOW,
  );

  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.deepEqual(
    plan.creates.map((c) => c.data.validFrom),
    [WK32.validFrom],
  );
  // Current-week price changed (1.99 → 1.49) → one point; next week is future → none.
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.49 }]);
});

test("a brand-new future-dated offer records no price history", () => {
  const plan = buildOfferPlan([], [write("p1", 2.5, WK32)], NOW);

  assert.equal(plan.creates.length, 1);
  assert.deepEqual(plan.history, []);
});
