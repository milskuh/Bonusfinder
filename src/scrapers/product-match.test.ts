// Unit tests for the cross-store product match key. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { productMatchKey, parseSizeFromText, type ProductIdentity } from "./product-match";

const key = (p: ProductIdentity) => productMatchKey(p);

test("identical labels produce the same key (baseline)", () => {
  assert.equal(key({ name: "Halfvolle melk", brand: "Campina" }), key({ name: "Halfvolle melk", brand: "Campina" }));
});

test("case, punctuation and diacritics are folded away", () => {
  assert.equal(
    key({ name: "Crème Brûlée Dessert", brand: "Mona" }),
    key({ name: "creme brulee dessert", brand: "MONA" }),
  );
  assert.equal(
    key({ name: "Coca-Cola", brand: null }),
    key({ name: "Coca Cola", brand: null }),
  );
});

test("word order and a brand repeated inside the name don't matter", () => {
  // Brand + name with the brand echoed in the name, in different orders.
  assert.equal(
    key({ name: "Coca-Cola Zero", brand: "Coca-Cola" }),
    key({ name: "Zero Coca Cola", brand: null }),
  );
});

test("the same article at the same size matches across stores despite label noise", () => {
  const ah = key({ name: "Coca-Cola 1,5 L", brand: "Coca-Cola" });
  const jumbo = key({ name: "Coca Cola 1.5l", brand: null });
  const structured = key({ name: "Coca-Cola", brand: "Coca-Cola", contentAmount: 1500, contentUnit: "ml" });
  assert.equal(ah, jumbo);
  assert.equal(ah, structured);
});

test("different pack sizes of the same article stay distinct (no false merge)", () => {
  assert.notEqual(
    key({ name: "Coca-Cola 1 L", brand: "Coca-Cola" }),
    key({ name: "Coca-Cola 1,5 L", brand: "Coca-Cola" }),
  );
});

test("a multiplier pack resolves to its total and matches the structured size", () => {
  // 6 x 33 cl = 1.98 l.
  assert.equal(
    key({ name: "Heineken pils 6 x 33 cl", brand: "Heineken" }),
    key({ name: "Heineken pils", brand: "Heineken", contentAmount: 1.98, contentUnit: "l" }),
  );
});

test("grams and kilograms are the same base unit (500 g == 0,5 kg)", () => {
  assert.equal(
    key({ name: "Gehakt 500 g", brand: null }),
    key({ name: "Gehakt 0,5 kg", brand: null }),
  );
});

test("house brand vs A-brand of the same item do NOT match", () => {
  assert.notEqual(
    key({ name: "Halfvolle melk 1 L", brand: "AH" }),
    key({ name: "Halfvolle melk 1 L", brand: "Campina" }),
  );
});

test("stopwords are ignored so trivial phrasing differences match", () => {
  assert.equal(
    key({ name: "Melk met honing", brand: null }),
    key({ name: "Melk honing", brand: null }),
  );
});

test("a size-less label does not merge into a sized one (missed, not false)", () => {
  // The recall trade-off: without a size we can only match another size-less
  // label. This must be a different key, never a wrong merge.
  assert.notEqual(
    key({ name: "Coca-Cola", brand: "Coca-Cola" }),
    key({ name: "Coca-Cola 1,5 L", brand: "Coca-Cola" }),
  );
});

test("structured size wins but the size words are still stripped from the tokens", () => {
  // Name says 1 L, structured content says 1.5 l — structured is authoritative,
  // and the "1 l" text must not leak into the word set.
  const k = key({ name: "Coca-Cola 1 L", brand: "Coca-Cola", contentAmount: 1.5, contentUnit: "l" });
  assert.equal(k, "coca cola|1.5l");
});

test("an unrecognised unit yields no size rather than a bogus one", () => {
  const { size, cleaned } = parseSizeFromText("Snoep 5 rollen");
  assert.equal(size, null);
  assert.match(cleaned, /snoep/);
});

test("parseSizeFromText strips the size text and reports the base unit", () => {
  const single = parseSizeFromText("Yoghurt 500 g");
  assert.deepEqual(single.size, { amount: 0.5, unit: "kg" });
  assert.equal(single.cleaned.includes("500"), false);

  const mult = parseSizeFromText("Cola 6 x 33 cl");
  assert.deepEqual(mult.size, { amount: 1.98, unit: "l" });
  assert.equal(/\d/.test(mult.cleaned), false);
});
