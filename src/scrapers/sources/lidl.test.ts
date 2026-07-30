// Unit tests for the Lidl scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  discoverOffersUrl,
  parseGridData,
  parseLidlContent,
  productToOffer,
} from "./lidl";

// --- discoverOffersUrl -------------------------------------------------------

test("discoverOffersUrl picks the most-linked aanbiedingen path", () => {
  const html = `<a href="/c/aanbiedingen/a10008785">x</a> <a href="/c/aanbiedingen/a10008785">y</a> <a href="/c/aanbiedingen/a999">z</a>`;
  assert.equal(discoverOffersUrl(html), "https://www.lidl.nl/c/aanbiedingen/a10008785");
});

test("discoverOffersUrl returns null when there's no offers link", () => {
  assert.equal(discoverOffersUrl("<html>nothing</html>"), null);
});

// --- parseGridData (entity-encoded inline JSON) ------------------------------

test("parseGridData decodes and dedupes the inline tile JSON", () => {
  const tile = { productId: "p1", fullTitle: "NESCAFÉ Gold", price: { price: 6.49 } };
  const enc = JSON.stringify(tile).replace(/"/g, "&quot;");
  // Same product appears twice (placeholder + content) → deduped to one.
  const html = `<div data-grid-data="${enc}"></div><div data-grid-data="${enc}"></div>`;
  const products = parseGridData(html);
  assert.equal(products.length, 1);
  assert.equal(products[0].fullTitle, "NESCAFÉ Gold");
  assert.equal(products[0].price?.price, 6.49);
});

// --- parseLidlContent --------------------------------------------------------

test("parseLidlContent normalizes pack sizes to kg/l/stuk", () => {
  assert.deepEqual(parseLidlContent("200 g"), { contentAmount: 0.2, contentUnit: "kg" });
  assert.deepEqual(parseLidlContent("1 kg"), { contentAmount: 1, contentUnit: "kg" });
  assert.deepEqual(parseLidlContent("0,5 l"), { contentAmount: 0.5, contentUnit: "l" });
  assert.deepEqual(parseLidlContent("500 ml"), { contentAmount: 0.5, contentUnit: "l" });
  assert.deepEqual(parseLidlContent("6 stuks"), { contentAmount: 6, contentUnit: "stuk" });
  assert.deepEqual(parseLidlContent("2 x 250 g"), { contentAmount: 0.5, contentUnit: "kg" });
  assert.deepEqual(parseLidlContent("kaas"), { contentAmount: null, contentUnit: null });
  assert.deepEqual(parseLidlContent(null), { contentAmount: null, contentUnit: null });
});

// --- productToOffer ----------------------------------------------------------

const base = {
  productId: "p10031071",
  fullTitle: "Rode pitloze druiven",
  title: "Rode pitloze druiven",
  brand: { showBrand: false },
  productType: "RETAIL",
  havingPrice: true,
  canonicalPath: "/p/rode-pitloze-druiven/p10031071",
  image: "https://imgproxy-retcat.assets.schwarz/abc.png",
  imageList_V1: [{ image: "https://imgproxy-retcat.assets.schwarz/list.png" }],
  storeStartDate: 1785103200, // 2026-07-27
  storeEndDate: 1785707999, // 2026-08-02
  price: {
    price: 1.19,
    oldPrice: 2.49,
    packaging: { text: "500 g" },
    discount: { deletedPrice: 2.49 },
  },
};

test("productToOffer computes a real discount via normalize", () => {
  const offer = productToOffer(base)!;
  assert.equal(offer.name, "Rode pitloze druiven");
  assert.equal(offer.category, Category.FRUIT); // "druiven"
  assert.equal(offer.salePrice, 1.19);
  assert.equal(offer.originalPrice, 2.49);
  assert.equal(offer.discountPercent, 52); // round((2.49-1.19)/2.49*100)
  assert.equal(offer.offerText, null);
  assert.equal(offer.imageUrl, "https://imgproxy-retcat.assets.schwarz/list.png"); // list preferred
  assert.equal(offer.deepLink, "https://www.lidl.nl/p/rode-pitloze-druiven/p10031071");
  assert.deepEqual(
    { a: offer.contentAmount, u: offer.contentUnit },
    { a: 0.5, u: "kg" },
  );
  assert.equal(offer.validUntil.toISOString().slice(0, 10), "2026-08-02");
});

test("productToOffer treats a lone price (no was) as no discount", () => {
  const offer = productToOffer({
    ...base,
    price: { price: 0.99, packaging: { text: "1 stuk" } },
  })!;
  assert.equal(offer.salePrice, 0.99);
  assert.equal(offer.originalPrice, null);
  assert.equal(offer.discountPercent, null);
});

test("productToOffer skips gift cards, non-retail, priceless and blocked items", () => {
  assert.equal(productToOffer({ ...base, isLidlGiftCard: true }), null);
  assert.equal(productToOffer({ ...base, preventSelling: true }), null);
  assert.equal(productToOffer({ ...base, havingPrice: false }), null);
  assert.equal(productToOffer({ ...base, productType: "SERVICE" }), null);
  assert.equal(productToOffer({ ...base, price: { price: 0 } }), null);
  assert.equal(productToOffer({ ...base, fullTitle: "", title: "" }), null);
});
