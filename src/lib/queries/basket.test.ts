// Unit tests for the pure "cheapest basket" optimiser. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  optimizeBasket,
  type BasketLine,
  type BasketOffer,
  type BasketProduct,
} from "./basket";

// --- Terse fixture builders (only the fields under test vary) ----------------

const prod = (id: string): BasketProduct => ({
  id,
  name: id,
  nameEn: null,
  brand: null,
  imageUrl: null,
});

const line = (productId: string, quantity = 1): BasketLine => ({
  productId,
  quantity,
  product: prod(productId),
});

const offer = (
  productId: string,
  slug: string,
  salePriceCents: number | null,
  offerText: string | null = null,
): BasketOffer => ({
  productId,
  supermarket: { slug, name: slug.toUpperCase(), logoUrl: null },
  salePriceCents,
  offerText,
});

test("an item cheaper at store B than A: multi-store picks B, both stores appear single-store", () => {
  const res = optimizeBasket(
    [line("milk")],
    [offer("milk", "ah", 199), offer("milk", "jumbo", 149)],
  );

  assert.equal(res.multiStore.lines.length, 1);
  assert.equal(res.multiStore.lines[0].supermarket.slug, "jumbo");
  assert.equal(res.multiStore.lines[0].unitPriceCents, 149);
  assert.equal(res.multiStore.totalCents, 149);
  assert.equal(res.multiStore.storeCount, 1);

  // Both stores can price it, cheapest total first.
  assert.deepEqual(
    res.singleStore.perStore.map((p) => [p.supermarket.slug, p.totalCents]),
    [["jumbo", 149], ["ah", 199]],
  );
  assert.equal(res.singleStore.best?.supermarket.slug, "jumbo");

  // Savings: 199 (priciest) − 149 (multi) = 50, = 25.1% of 199.
  assert.equal(res.savings.mostExpensiveStore?.slug, "ah");
  assert.equal(res.savings.amountCents, 50);
  assert.equal(res.savings.percent, 25.1);

  assert.equal(res.pricedItemCount, 1);
  assert.deepEqual(res.needsAttention, []);
});

test("tie on price is broken deterministically by slug ascending", () => {
  const res = optimizeBasket(
    [line("x")],
    [offer("x", "jumbo", 100), offer("x", "ah", 100)],
  );

  assert.equal(res.multiStore.lines[0].supermarket.slug, "ah");
  assert.equal(res.multiStore.totalCents, 100);
});

test("an item priced at only one store: covered there, no saving to be had", () => {
  const res = optimizeBasket([line("eggs")], [offer("eggs", "ah", 250)]);

  assert.equal(res.multiStore.totalCents, 250);
  assert.equal(res.multiStore.lines[0].supermarket.slug, "ah");
  assert.equal(res.singleStore.perStore.length, 1);
  assert.deepEqual(res.singleStore.best?.coverage, { covered: 1, total: 1 });
  assert.equal(res.savings.amountCents, 0);
  assert.equal(res.savings.percent, 0);
});

test("an item whose offers are all price-less promos → needs attention, never €0", () => {
  const res = optimizeBasket(
    [line("cola")],
    [offer("cola", "ah", null, "1+1 gratis"), offer("cola", "jumbo", null, "2e halve prijs")],
  );

  // Excluded from every total.
  assert.equal(res.multiStore.totalCents, 0);
  assert.equal(res.multiStore.lines.length, 0);
  assert.equal(res.singleStore.perStore.length, 0);
  assert.equal(res.singleStore.best, null);
  assert.equal(res.pricedItemCount, 0);

  // Surfaced with its promo text (representative = first by slug) + all promos.
  assert.equal(res.needsAttention.length, 1);
  const item = res.needsAttention[0];
  assert.equal(item.reason, "no-price");
  assert.equal(item.offerText, "1+1 gratis");
  assert.deepEqual(
    item.promos.map((p) => [p.supermarket.slug, p.offerText]),
    [["ah", "1+1 gratis"], ["jumbo", "2e halve prijs"]],
  );
});

test("an item with no active offer anywhere → needs attention, reason no-offer", () => {
  const res = optimizeBasket([line("caviar")], [offer("milk", "ah", 100)]);

  assert.equal(res.needsAttention.length, 1);
  assert.equal(res.needsAttention[0].reason, "no-offer");
  assert.equal(res.needsAttention[0].offerText, null);
  assert.deepEqual(res.needsAttention[0].promos, []);
  assert.equal(res.pricedItemCount, 0);
});

test("quantity multiplies the unit price into the line and store totals", () => {
  const res = optimizeBasket([line("water", 3)], [offer("water", "lidl", 89)]);

  assert.equal(res.multiStore.lines[0].quantity, 3);
  assert.equal(res.multiStore.lines[0].unitPriceCents, 89);
  assert.equal(res.multiStore.lines[0].lineTotalCents, 267);
  assert.equal(res.multiStore.totalCents, 267);
  assert.equal(res.singleStore.best?.totalCents, 267);
});

test("multi-item basket: savings and coverage across stores", () => {
  const res = optimizeBasket(
    [line("milk"), line("bread"), line("cheese")],
    [
      offer("milk", "ah", 100),
      offer("milk", "jumbo", 120),
      offer("bread", "ah", 200),
      offer("bread", "jumbo", 150),
      offer("cheese", "ah", 300), // only AH carries cheese
    ],
  );

  // Multi-store: milk@ah 100 + bread@jumbo 150 + cheese@ah 300 = 550, over 2 stores.
  assert.equal(res.multiStore.totalCents, 550);
  assert.equal(res.multiStore.storeCount, 2);
  assert.deepEqual(
    res.multiStore.lines.map((l) => [l.productId, l.supermarket.slug, l.lineTotalCents]),
    [["milk", "ah", 100], ["bread", "jumbo", 150], ["cheese", "ah", 300]],
  );

  // Single-store cheapest = jumbo by total (270) but it only covers 2 of 3 items;
  // AH covers all 3 but totals 600. Coverage makes that trade-off visible.
  assert.equal(res.singleStore.best?.supermarket.slug, "jumbo");
  assert.equal(res.singleStore.best?.totalCents, 270);
  assert.deepEqual(res.singleStore.best?.coverage, { covered: 2, total: 3 });
  const ah = res.singleStore.perStore.find((p) => p.supermarket.slug === "ah");
  assert.equal(ah?.totalCents, 600);
  assert.deepEqual(ah?.coverage, { covered: 3, total: 3 });

  // Savings vs the priciest single store (AH, 600): 600 − 550 = 50 = 8.3%.
  assert.equal(res.savings.mostExpensiveStore?.slug, "ah");
  assert.equal(res.savings.amountCents, 50);
  assert.equal(res.savings.percent, 8.3);

  assert.equal(res.pricedItemCount, 3);
  assert.deepEqual(res.needsAttention, []);
});

test("mixed basket: priced, price-less, and no-offer items coexist correctly", () => {
  const res = optimizeBasket(
    [line("milk"), line("cola"), line("caviar")],
    [
      offer("milk", "ah", 100),
      offer("milk", "jumbo", 120),
      offer("cola", "ah", null, "1+1 gratis"),
    ],
  );

  assert.equal(res.itemCount, 3);
  assert.equal(res.pricedItemCount, 1);
  assert.equal(res.multiStore.totalCents, 100);

  // Needs-attention preserves input order: cola (no-price) then caviar (no-offer).
  assert.deepEqual(
    res.needsAttention.map((n) => [n.productId, n.reason]),
    [["cola", "no-price"], ["caviar", "no-offer"]],
  );
});

test("no single store covers the whole basket: multi-store spans stores, saving is not positive", () => {
  // A only at X, B only at Y — buying both needs two stores.
  const res = optimizeBasket(
    [line("A"), line("B")],
    [offer("A", "x", 1000), offer("B", "y", 1000)],
  );

  assert.equal(res.multiStore.totalCents, 2000);
  assert.equal(res.multiStore.storeCount, 2);

  // Each store covers only half; the "savings vs priciest single store" figure is
  // negative here (2000 multi vs 1000 single) — the UI must not advertise it as a
  // saving. Pinned so the raw arithmetic is never silently clamped or fabricated.
  assert.equal(res.savings.mostExpensiveTotalCents, 1000);
  assert.equal(res.savings.amountCents, -1000);
  assert.deepEqual(res.singleStore.best?.coverage, { covered: 1, total: 2 });
});

test("empty basket yields an all-zero result, no crash", () => {
  const res = optimizeBasket([], []);

  assert.equal(res.itemCount, 0);
  assert.equal(res.pricedItemCount, 0);
  assert.equal(res.multiStore.totalCents, 0);
  assert.equal(res.multiStore.storeCount, 0);
  assert.equal(res.singleStore.best, null);
  assert.equal(res.savings.amountCents, 0);
  assert.deepEqual(res.needsAttention, []);
});
