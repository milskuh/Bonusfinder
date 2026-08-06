// Unit tests for the Gall & Gall scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  parseVariant,
  mapGallCategory,
  tileToOffer,
  parseActieEndDate,
  actiePeriod,
  collectActieCategoryUrls,
  parseActiePage,
  type GallProduct,
} from "./gall";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const VF = new Date(2026, 7, 3);
const VU = new Date(2026, 7, 23, 23, 59, 59);

// --- parseVariant -----------------------------------------------------------

test("parseVariant normalises CL/ML/L to litres and ST to stuk", () => {
  assert.deepEqual(parseVariant("75CL"), { contentAmount: 0.75, contentUnit: "l" });
  assert.deepEqual(parseVariant("100CL"), { contentAmount: 1, contentUnit: "l" });
  assert.deepEqual(parseVariant("1.5L"), { contentAmount: 1.5, contentUnit: "l" });
  assert.deepEqual(parseVariant("330ML"), { contentAmount: 0.33, contentUnit: "l" });
  assert.deepEqual(parseVariant("1ST"), { contentAmount: 1, contentUnit: "stuk" });
  assert.deepEqual(parseVariant(undefined), { contentAmount: null, contentUnit: null });
});

// --- mapGallCategory --------------------------------------------------------

test("mapGallCategory: drink aisles → ALCOHOL, alcohol-free → SODA, gifts → null", () => {
  assert.equal(mapGallCategory("Wijn/Rosé wijn/…"), Category.ALCOHOL);
  assert.equal(mapGallCategory("Mixen"), Category.ALCOHOL);
  assert.equal(mapGallCategory("Whisky"), Category.ALCOHOL);
  assert.equal(mapGallCategory("Alcoholvrij/Alcoholarm"), Category.SODA);
  assert.equal(mapGallCategory("Cadeau"), null);
  assert.equal(mapGallCategory("Accessoires"), null);
  assert.equal(mapGallCategory(""), null);
});

// --- tileToOffer ------------------------------------------------------------

const mk = (dp: GallProduct, badge: string | null = null) =>
  tileToOffer(dp, badge, "https://www.gall.nl/x-129429.html", "https://static.gall.nl/x_500.png", VF, VU);

test("tileToOffer: straight cut → salePrice = price - discount, normalize computes %", () => {
  const o = mk({ name: "Pierre de Prunet Rosé", id: "1", price: 6.65, discount: 1.66, brand: "Pierre De Prunet", category: "Wijn/Rosé wijn", variant: "75CL" })!;
  assert.equal(o.salePrice, 4.99);
  assert.equal(o.originalPrice, 6.65);
  assert.equal(o.discountPercent, 25); // round((6.65-4.99)/6.65*100)
  assert.equal(o.offerText, null);
  assert.equal(o.brand, "Pierre De Prunet");
  assert.equal(o.category, Category.ALCOHOL); // "rosé"/"wijn" → ALCOHOL
  assert.deepEqual({ a: o.contentAmount, u: o.contentUnit }, { a: 0.75, u: "l" });
  assert.equal(ymd(o.validFrom), "2026-08-03");
});

test("tileToOffer: '2e halve prijs' badge (discount 0) keeps shelf price, no synthetic %", () => {
  const o = mk({ name: "STËLZ Mango", id: "2", price: 2.19, discount: 0, category: "Mixen", variant: "25CL" }, "2e halve prijs")!;
  assert.equal(o.salePrice, 2.19);
  assert.equal(o.originalPrice, null);
  assert.equal(o.discountPercent, null);
  assert.equal(o.offerText, "2e halve prijs");
  // Gall path "Mixen" (alcohol) overrides the "mango" → FRUIT name match.
  assert.equal(o.category, Category.ALCOHOL);
});

test("tileToOffer: an alcohol-free aisle → SODA, never ALCOHOL (even if the name says bier)", () => {
  const o = mk({ name: "Heineken 0.0 bier", id: "8", price: 8.99, discount: 2, category: "Alcoholvrij/Alcoholarm bier" })!;
  assert.equal(o.category, Category.SODA);
});

test("tileToOffer: '2e fles 50% korting' with a per-unit discount stays multi-buy (no %)", () => {
  const o = mk({ name: "Torres Viña Sol Bio", id: "3", price: 6.65, discount: 1.5, category: "Wijn" }, "2e fles 50% korting")!;
  assert.equal(o.discountPercent, null); // isMultibuyBadge guards the "2e …" phrasing
  assert.equal(o.originalPrice, null);
  assert.equal(o.offerText, "2e fles 50% korting");
});

test("tileToOffer: 'OP=OP' is a flag, not a mechanic → real % is still computed", () => {
  const o = mk({ name: "Mucho Mas Blanco", id: "4", price: 7.79, discount: 1.8, category: "Wijn" }, "OP=OP")!;
  assert.equal(o.salePrice, 5.99);
  assert.equal(o.originalPrice, 7.79);
  assert.equal(o.discountPercent, 23);
  assert.equal(o.offerText, "OP=OP");
});

test("tileToOffer: no discount and no badge → not an offer (null)", () => {
  assert.equal(mk({ name: "Lavis Pinot Grigio", id: "5", price: 10.65, discount: 0, category: "Wijn" }), null);
  assert.equal(mk({ name: "", id: "6", price: 5, discount: 1 }), null); // no name
  assert.equal(mk({ id: "7", discount: 1, category: "Wijn" }), null); // no price
});

// --- validity ---------------------------------------------------------------

test("parseActieEndDate reads 'geldig t/m zondag 23 augustus'", () => {
  const end = parseActieEndDate('<img alt="geldig t/m zondag 23 augustus">', new Date(2026, 7, 6))!;
  assert.equal(ymd(end), "2026-08-23");
  assert.equal(end.getHours(), 23);
  assert.equal(parseActieEndDate("<div>no date here</div>", new Date()), null);
});

test("actiePeriod: validFrom is a stable Monday derived from the fixed end date", () => {
  const end = new Date(2026, 7, 23, 23, 59, 59); // Sun 23 Aug
  const a = actiePeriod(end, new Date(2026, 7, 6));
  const b = actiePeriod(end, new Date(2026, 7, 18)); // a later scrape, same actie
  assert.equal(ymd(a.validUntil), "2026-08-23");
  assert.equal(a.validFrom.getDay(), 1); // Monday
  assert.ok(a.validFrom.getTime() <= new Date(2026, 7, 6).getTime()); // in the past → shows as current
  assert.equal(ymd(a.validFrom), ymd(b.validFrom)); // identical across scrapes → no week-bucket drift
});

// --- collectActieCategoryUrls ----------------------------------------------

test("collectActieCategoryUrls keeps clean /acties/<cat>/ paths, drops folders + params", () => {
  const html = `
    <a href="/acties/wijn/">wijn</a>
    <a href="/acties/whisky/">whisky</a>
    <a href="/acties/folders/">folder</a>
    <a href="/acties/wijn/?start=24">page 2</a>
    <a href="/acties/">landing</a>
    <a href="/winkelmand">cart</a>`;
  const urls = collectActieCategoryUrls(html);
  assert.deepEqual(urls.sort(), [
    "https://www.gall.nl/acties/whisky/",
    "https://www.gall.nl/acties/wijn/",
  ]);
});

// --- parseActiePage (integration) ------------------------------------------

const tile = (dp: object, badge?: string) => `
  <div class="c-product" data-pid="${(dp as GallProduct).id}">
    <div class="ptile" data-product='${JSON.stringify(dp)}'>
      <a class="ptile_link" href="/prod-${(dp as GallProduct).id}.html">
        <img class="img" src="https://static.gall.nl/x_200.png" srcset="https://static.gall.nl/x_60.png 60w, https://static.gall.nl/x_500.png 500w">
      </a>
      <h2>${(dp as GallProduct).name}</h2>
      ${badge ? `<div class="has-favorites"><p class="ptile_badges"><em><span>${badge}</span></em></p></div>` : ""}
    </div>
  </div>`;

test("parseActiePage extracts offers by pid, widest image + deep link", () => {
  const html = `<div class="product-grid">
    ${tile({ name: "Jameson", id: "719021", price: 34.49, discount: 8.5, brand: "Jameson", category: "Whisky", variant: "100CL" })}
    ${tile({ name: "STËLZ Mango", id: "160644", price: 2.19, discount: 0, category: "Mixen", variant: "25CL" }, "2e halve prijs")}
    ${tile({ name: "Filler", id: "999", price: 10, discount: 0, category: "Overig" })}
  </div>`;
  const map = parseActiePage(html, VF, VU);
  assert.equal(map.size, 2); // Filler (no discount, no badge) is skipped

  const j = map.get("719021")!;
  assert.equal(j.name, "Jameson");
  assert.equal(j.salePrice, 25.99);
  assert.equal(j.discountPercent, 25);
  assert.equal(j.imageUrl, "https://static.gall.nl/x_500.png"); // widest srcset
  assert.equal(j.deepLink, "https://www.gall.nl/prod-719021.html");

  const m = map.get("160644")!;
  assert.equal(m.offerText, "2e halve prijs");
  assert.equal(m.discountPercent, null);
});
