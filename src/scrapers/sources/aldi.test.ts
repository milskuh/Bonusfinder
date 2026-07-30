// Unit tests for the Aldi scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import { parseAldiOffers, productToOffer, type AldiProduct } from "./aldi";

// --- parseAldiOffers ---------------------------------------------------------

test("parseAldiOffers reads the OFFER_GET algoliaDataMap from __NEXT_DATA__", () => {
  const apiData = JSON.stringify([
    ["OFFER_GET", { res: { algoliaDataMap: { "1": { objectID: "1", name: "A" }, "2": { objectID: "2", name: "B" } } } }],
    ["PAGE_MGNL_GET", { res: {} }],
  ]);
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { apiData } },
  })}</script></html>`;
  const products = parseAldiOffers(html);
  assert.equal(products.length, 2);
  assert.deepEqual(products.map((p) => p.name).sort(), ["A", "B"]);
});

test("parseAldiOffers throws clearly when the payload is missing", () => {
  assert.throws(() => parseAldiOffers("<html>no next data</html>"), /__NEXT_DATA__ not found/);
});

// --- productToOffer ----------------------------------------------------------

const withStrike: AldiProduct = {
  objectID: "1202915",
  name: "Special cornets",
  brandName: "MUCCI",
  isAvailable: true,
  salesUnit: "6 stuks",
  mainCategoryID: "ijs",
  productSlug: "special-cornets-1202915",
  assets: [
    { type: "gallery", url: "https://s7g10.scene7.com/is/image/aldinord/g" },
    { type: "primary", url: "https://s7g10.scene7.com/is/image/aldinord/p" },
  ],
  currentPrice: {
    priceValue: 1.89,
    strikePrice: { strikePriceValue: 2.99 },
    basePrice: [{ basePriceValue: 3.71, basePriceScale: "l" }],
    priceTagLabels: { promoText1: "-36%" },
    validFrom: 1785103200, // 2026-07-27 (NL)
    validUntil: 1785707999, // 2026-08-02 (NL)
  },
};

test("productToOffer computes a real discount from the strike price", () => {
  const offer = productToOffer(withStrike)!;
  assert.equal(offer.name, "Special cornets");
  assert.equal(offer.brand, "MUCCI");
  assert.equal(offer.salePrice, 1.89);
  assert.equal(offer.originalPrice, 2.99);
  assert.equal(offer.discountPercent, 37); // round((2.99-1.89)/2.99*100)
  assert.equal(offer.offerText, null);
  assert.equal(offer.imageUrl, "https://s7g10.scene7.com/is/image/aldinord/p"); // primary preferred
  assert.equal(offer.deepLink, "https://www.aldi.nl/product/special-cornets-1202915.html");
  assert.equal(offer.subcategory, "ijs");
  assert.equal(offer.validUntil.toISOString().slice(0, 10), "2026-08-02");
});

test("productToOffer backs the pack size out of the base price (per l/kg)", () => {
  const offer = productToOffer(withStrike)!;
  // basePrice 3.71/l with sale 1.89 → contentAmount ≈ 0.509 l, so persist's
  // salePrice/contentAmount reproduces ~3.71/l.
  assert.equal(offer.contentUnit, "l");
  assert.ok(offer.contentAmount != null && Math.abs(offer.contentAmount - 1.89 / 3.71) < 0.001);
});

test("productToOffer treats a lone price (no strike) as no discount", () => {
  const offer = productToOffer({
    objectID: "1201308",
    name: "Aster",
    isAvailable: true,
    salesUnit: "Per stuk",
    mainCategoryID: "offer",
    currentPrice: { priceValue: 1.99, priceTagLabels: { promoText1: "OP=OP" }, validFrom: 1785103200, validUntil: 1785707999 },
  })!;
  assert.equal(offer.salePrice, 1.99);
  assert.equal(offer.originalPrice, null);
  assert.equal(offer.discountPercent, null);
  assert.equal(offer.offerText, null);
  assert.equal(offer.brand, null);
});

test("productToOffer maps a 'N VOOR' tag to a multi-buy (no synthesized %)", () => {
  const offer = productToOffer({
    objectID: "1216090",
    name: "Quickwash afwasmiddel",
    isAvailable: true,
    salesUnit: "350 ml",
    currentPrice: {
      priceValue: 3, // bundle price for 2
      strikePrice: { strikePriceValue: 5.98 },
      priceTagLabels: { promoText1: "2 VOOR" },
      validFrom: 1785103200,
      validUntil: 1785707999,
    },
  })!;
  assert.equal(offer.offerText, "2 voor 3,00");
  assert.equal(offer.salePrice, 3); // bundle price kept
  assert.equal(offer.originalPrice, null); // multi-buy: was-price dropped
  assert.equal(offer.discountPercent, null); // never synthesized
  assert.equal(offer.contentAmount, null); // no unit price for a bundle
});

test("productToOffer skips unusable products", () => {
  assert.equal(productToOffer({ name: "  ", currentPrice: { priceValue: 1 } }), null);
  assert.equal(productToOffer({ name: "X", isAvailable: false, currentPrice: { priceValue: 1 } }), null);
  assert.equal(productToOffer({ name: "X", currentPrice: {} }), null); // no price
  assert.equal(productToOffer({ name: "X" }), null);
});

test("productToOffer categorizes from the name", () => {
  const offer = productToOffer({
    name: "Zalmfilet",
    isAvailable: true,
    currentPrice: { priceValue: 4.99, validFrom: 1785103200, validUntil: 1785707999 },
  })!;
  assert.equal(offer.category, Category.VIS);
});
