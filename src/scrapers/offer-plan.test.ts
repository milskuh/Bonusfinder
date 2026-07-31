// Unit tests for the offer ingestion planner. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOfferPlan, type ExistingOffer, type OfferWrite } from "./offer-plan";

const win = { validFrom: new Date("2026-07-27"), validUntil: new Date("2026-08-02") };

/** Terse OfferWrite builder — only price varies across most cases. */
function write(productId: string, salePrice: number | null): OfferWrite {
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

test("first ever scrape: everything is a create, with a history point per priced offer", () => {
  const plan = buildOfferPlan([], [write("p1", 1.99), write("p2", null)]);

  assert.equal(plan.updates.length, 0);
  assert.deepEqual(
    plan.creates.map((c) => c.productId),
    ["p1", "p2"],
  );
  // p2 has no price, so no history point for it.
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.99 }]);
});

test("re-scraping the same offer updates the existing row in place — no duplicate insert", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: 1.99 }];

  const plan = buildOfferPlan(existing, [write("p1", 1.99)]);

  assert.deepEqual(plan.creates, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "o1");
  // Same price -> no new history point (avoids piling up identical points daily).
  assert.deepEqual(plan.history, []);
});

test("a price change on an existing offer updates in place and records the new price", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: 1.99 }];

  const plan = buildOfferPlan(existing, [write("p1", 1.49)]);

  assert.equal(plan.updates[0].id, "o1");
  assert.deepEqual(plan.history, [{ productId: "p1", price: 1.49 }]);
});

test("a sub-cent price difference is treated as unchanged", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: 1.99 }];

  const plan = buildOfferPlan(existing, [write("p1", 1.991)]);

  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.history, []);
});

test("gaining a price where there was none is recorded", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: null }];

  const plan = buildOfferPlan(existing, [write("p1", 2.5)]);

  assert.deepEqual(plan.history, [{ productId: "p1", price: 2.5 }]);
});

test("an active offer that dropped out of the ad is left untouched (no update, no delete)", () => {
  // p1 is still on offer, p2 was active last week but is gone from this scrape.
  const existing: ExistingOffer[] = [
    { id: "o1", productId: "p1", salePrice: 1.99 },
    { id: "o2", productId: "p2", salePrice: 0.99 },
  ];

  const plan = buildOfferPlan(existing, [write("p1", 1.99)]);

  // Only p1 is updated; nothing references o2 — the planner never deletes, so o2
  // survives until it is pruned for being past its validUntil (in persist.ts).
  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.deepEqual(plan.creates, []);
});

test("mix of continuing and brand-new offers", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: 1.99 }];

  const plan = buildOfferPlan(existing, [write("p1", 1.99), write("p2", 3.49)]);

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
  const existing: ExistingOffer[] = [
    { id: "o1", productId: "p1", salePrice: 1.99 },
    { id: "o2", productId: "p1", salePrice: 2.49 },
  ];

  const plan = buildOfferPlan(existing, [write("p1", 1.99), write("p1", 2.49)]);

  // Both map onto existing rows — no accumulation of duplicates across runs.
  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1", "o2"],
  );
  assert.deepEqual(plan.creates, []);
});

test("more scraped offers than existing rows for a product: overflow becomes a create", () => {
  const existing: ExistingOffer[] = [{ id: "o1", productId: "p1", salePrice: 1.99 }];

  const plan = buildOfferPlan(existing, [write("p1", 1.99), write("p1", 2.49)]);

  assert.deepEqual(
    plan.updates.map((u) => u.id),
    ["o1"],
  );
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].data.salePrice, 2.49);
});
