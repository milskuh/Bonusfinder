// Unit tests for the Dirk scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  parseSalePrice,
  parseOriginalPrice,
  parseDirkContent,
  isWeekendLabel,
  mapDirkSectionCategory,
  categoryFor,
  parseDutchDate,
  periodFromEndDate,
  weekendWindow,
  parseOffersPage,
} from "./dirk";

// Local Y-M-D (dates are built in local time, so assert with local getters — not
// toISOString, which would shift the day under a non-UTC machine timezone).
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// --- parseSalePrice: THE cents gotcha ---------------------------------------

test("parseSalePrice: hasEuros splits euros + cents", () => {
  assert.equal(parseSalePrice(true, "3", "99"), 3.99);
  assert.equal(parseSalePrice(true, "14", "96"), 14.96);
  assert.equal(parseSalePrice(true, "6", "47"), 6.47);
});

test("parseSalePrice: no hasEuros → price-large is integer CENTS (49 = €0.49)", () => {
  assert.equal(parseSalePrice(false, "49", null), 0.49);
  assert.equal(parseSalePrice(false, "99", null), 0.99);
  assert.equal(parseSalePrice(false, "9", null), 0.09);
});

test("parseSalePrice: hasEuros with no cents span is a whole euro", () => {
  assert.equal(parseSalePrice(true, "5", null), 5);
});

test("parseSalePrice: no digits → null", () => {
  assert.equal(parseSalePrice(true, "", null), null);
  assert.equal(parseSalePrice(false, null, null), null);
});

// --- parseOriginalPrice ("van X.XX") ----------------------------------------

test("parseOriginalPrice reads the 'van X.XX' was-price (euros with a dot)", () => {
  assert.equal(parseOriginalPrice(" van 3.49"), 3.49);
  assert.equal(parseOriginalPrice(" van 9.09"), 9.09);
  assert.equal(parseOriginalPrice("van 14.49"), 14.49);
  assert.equal(parseOriginalPrice("van 3,49"), 3.49); // comma tolerated
});

test("parseOriginalPrice: null when there is no 'van' price", () => {
  assert.equal(parseOriginalPrice("ACTIE"), null);
  assert.equal(parseOriginalPrice(null), null);
});

// --- isWeekendLabel ---------------------------------------------------------

test("isWeekendLabel matches the weekend deal label only", () => {
  assert.equal(isWeekendLabel("VR, ZA & ZO actie"), true);
  assert.equal(isWeekendLabel("vr, za & zo actie"), true); // case-insensitive
  assert.equal(isWeekendLabel("ACTIE"), false);
  assert.equal(isWeekendLabel(null), false);
});

// --- parseDirkContent (pack size) -------------------------------------------

test("parseDirkContent parses pack sizes to a base unit", () => {
  assert.deepEqual(parseDirkContent("Zak 1 kilo."), { contentAmount: 1, contentUnit: "kg" });
  assert.deepEqual(parseDirkContent("200 g"), { contentAmount: 0.2, contentUnit: "kg" });
  assert.deepEqual(parseDirkContent("Pak 1 liter."), { contentAmount: 1, contentUnit: "l" });
  assert.deepEqual(parseDirkContent("750 ml"), { contentAmount: 0.75, contentUnit: "l" });
  assert.deepEqual(parseDirkContent("Pak 3 stuks."), { contentAmount: 3, contentUnit: "stuk" });
});

test("parseDirkContent multiplies 'N x M unit' packs", () => {
  assert.deepEqual(parseDirkContent("24 x 300 ml"), { contentAmount: 7.2, contentUnit: "l" });
  assert.deepEqual(parseDirkContent("Bak 2 x 250 gram."), { contentAmount: 0.5, contentUnit: "kg" });
});

test("parseDirkContent: no parseable amount → null", () => {
  assert.deepEqual(parseDirkContent("Per stuk"), { contentAmount: null, contentUnit: null });
  assert.deepEqual(parseDirkContent(null), { contentAmount: null, contentUnit: null });
});

// --- mapDirkSectionCategory + categoryFor -----------------------------------

test("mapDirkSectionCategory maps department headings to Category", () => {
  assert.equal(mapDirkSectionCategory("Vlees, vis & vega"), Category.VLEES);
  assert.equal(mapDirkSectionCategory("Diepvries"), Category.DIEPVRIES);
  assert.equal(mapDirkSectionCategory("Snacks & snoep"), Category.SNACKS_SNOEP);
  assert.equal(mapDirkSectionCategory("Weekendverwenners"), null); // no clean mapping
});

test("categoryFor: a name keyword wins over the section", () => {
  // "zalm" → VIS even though the section says HOUDBAAR.
  assert.equal(categoryFor("Zalmfilet", null, Category.HOUDBAAR), Category.VIS);
});

test("categoryFor: falls back to the section when the name has no keyword", () => {
  assert.equal(categoryFor("Onbekend artikel", null, Category.DIEPVRIES), Category.DIEPVRIES);
  assert.equal(categoryFor("Onbekend artikel", null, null), Category.HOUDBAAR);
});

// --- validity ---------------------------------------------------------------

test("parseDutchDate parses 'day month' with an inferred year", () => {
  const d = parseDutchDate("4 augustus", new Date(2026, 6, 31, 12))!;
  assert.equal(ymd(d), "2026-08-04");
});

test("parseDutchDate rolls a far-past date into next year (Dec→Jan)", () => {
  const d = parseDutchDate("2 januari", new Date(2026, 11, 30, 12))!;
  assert.equal(ymd(d), "2027-01-02");
  assert.equal(parseDutchDate("geen datum", new Date()), null);
});

test("periodFromEndDate: Wed→Tue window is [end-6 .. end]", () => {
  const { validFrom, validUntil } = periodFromEndDate(new Date(2026, 7, 4)); // di 4 aug
  assert.equal(ymd(validFrom), "2026-07-29"); // wo
  assert.equal(validFrom.getHours(), 0);
  assert.equal(ymd(validUntil), "2026-08-04");
  assert.equal(validUntil.getHours(), 23);
});

test("weekendWindow: the Fri–Sun inside the period", () => {
  const { validFrom, validUntil } = weekendWindow(new Date(2026, 6, 29, 0, 0, 0), new Date(2026, 7, 4, 23, 59, 59));
  assert.equal(ymd(validFrom), "2026-07-31"); // vrijdag
  assert.equal(validFrom.getHours(), 0);
  assert.equal(ymd(validUntil), "2026-08-02"); // zondag
  assert.equal(validUntil.getHours(), 23);
});

// --- parseOffersPage (integration against a representative fixture) ----------

const IMG = "https://web-fileserver.dirk.nl/artikelen%2Fx.png";

/** A weekend "van 9.09 → 5.99" card for id 28162, shown twice on the real page. */
const weekendCard = `
  <article data-product-id="28162">
    <a href="/boodschappen/brood-beleg-koek/vlaai/28162" class="top" aria-label="Bekijk product">
      <img class="main-image" src="${IMG}?width=190">
    </a>
    <div class="logos right"><img src="https://web-fileserver.dirk.nl/logos/o.png" alt="Op=Op"></div>
    <div class="middle"><div class="price-container offer middle-item price">
      <div class="label price-label"><span class="description">VR, ZA &amp; ZO actie</span><span class="regular-price"> van <span>9.09</span></span></div>
      <div class="price"><span class="hasEuros price-large">5</span><span class="price-small">99</span></div>
    </div></div>
    <a href="/boodschappen/brood-beleg-koek/vlaai/28162" class="bottom"><p class="title">Appeltaart</p><span class="subtitle">Per stuk</span></a>
  </article>`;

const FIXTURE = `<!doctype html><html><body>
  <div class="header">
    <button class="animate calender-button current"><span class="top">tot en met</span><span class="day">di</span><span class="date">4 augustus</span></button>
    <button class="calender-button"><span class="top">vanaf</span><span class="day">wo</span><span class="date">5 augustus</span></button>
  </div>
  <section id="1" class="department"><h2>Weekendverwenners</h2><div class="offers">
    ${weekendCard}
  </div></section>
  <section id="2" class="department"><h2>Brood, beleg &amp; koek</h2><div class="offers">
    ${weekendCard}
    <article data-product-id="111">
      <div class="middle"><div class="price-container">
        <div class="label price-label"><span class="description">ACTIE</span></div>
        <div class="price"><span class="hasEuros price-large">2</span><span class="price-small">49</span></div>
      </div></div>
      <a class="bottom"><p class="title">Volkorenbrood</p><span class="subtitle">Heel brood 800 g</span></a>
    </article>
  </div></section>
  <section id="3" class="department"><h2>Aardappelen, groente &amp; fruit</h2><div class="offers">
    <article data-product-id="19899">
      <a href="/boodschappen/agf/suikermais/19899" class="top"><img class="main-image" src="${IMG}?width=190"></a>
      <div class="middle"><div class="price-container">
        <div class="label price-label"><span class="description">ACTIE</span></div>
        <div class="price"><span class="price-large">49</span></div>
      </div></div>
      <a href="/boodschappen/agf/suikermais/19899" class="bottom"><p class="title">Suikermais</p><span class="subtitle">Per stuk</span></a>
    </article>
    <article data-product-id="222">
      <div class="middle"><div class="price-container">
        <div class="label price-label"><span class="description">ACTIE</span><span class="regular-price"> van <span>3.49</span></span></div>
        <div class="price"><span class="hasEuros price-large">2</span><span class="price-small">79</span></div>
      </div></div>
      <a href="/boodschappen/agf/aardbeien/222" class="bottom"><p class="title">Aardbeien</p><span class="subtitle">Bak 2 x 250 gram. OP=OP</span></a>
    </article>
  </div></section>
</body></html>`;

const TODAY = new Date(2026, 6, 31, 12); // vr 31 juli 2026

test("parseOffersPage dedupes across sections, keeping the mapped-category card", () => {
  const offers = parseOffersPage(FIXTURE, TODAY);
  assert.equal(offers.length, 4); // 28162 (deduped), 111, 19899, 222
  const bySku = new Map(offers.map((o) => [o.deepLink?.match(/\/(\d+)$/)?.[1] ?? o.name, o]));

  const vlaai = bySku.get("28162")!;
  // Deduped to ONE, upgraded to its real category section (not "Weekendverwenners").
  assert.equal(vlaai.subcategory, "Brood, beleg & koek");
  assert.equal(vlaai.category, Category.BROOD_BANKET); // name keyword "appeltaart"
});

test("parseOffersPage: weekend van-price card → discount + weekend validity + offerText", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Appeltaart")!;
  assert.equal(o.salePrice, 5.99);
  assert.equal(o.originalPrice, 9.09);
  assert.equal(o.discountPercent, 34); // round((9.09-5.99)/9.09*100)
  assert.equal(o.offerText, "VR, ZA & ZO actie, Op=Op");
  assert.equal(o.deepLink, "https://www.dirk.nl/boodschappen/brood-beleg-koek/vlaai/28162");
  assert.equal(o.imageUrl, "https://web-fileserver.dirk.nl/artikelen%2Fx.png"); // ?width stripped
  assert.equal(ymd(o.validFrom), "2026-07-31"); // weekend Fri
  assert.equal(ymd(o.validUntil), "2026-08-02"); // weekend Sun
});

test("parseOffersPage: plain ACTIE (no 'van') has no synthesized discount, and offer-only cards have null url", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Volkorenbrood")!;
  assert.equal(o.salePrice, 2.49);
  assert.equal(o.originalPrice, null);
  assert.equal(o.discountPercent, null);
  assert.equal(o.offerText, null);
  assert.equal(o.deepLink, null); // no <a href="/boodschappen…"> on this card
  assert.equal(o.category, Category.BROOD_BANKET);
  assert.equal(ymd(o.validUntil), "2026-08-04"); // full Wed→Tue period, not the weekend
});

test("parseOffersPage: the sub-€1 cents case + section-fallback category", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Suikermais")!;
  assert.equal(o.salePrice, 0.49); // NOT 49 — the cents rule
  assert.equal(o.originalPrice, null);
  // "suikermais" has no category keyword → falls back to the section heading.
  assert.equal(o.category, Category.GROENTE);
});

test("parseOffersPage: ACTIE van X computes a real discount, Op=Op → offerText, multi-pack content", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Aardbeien")!;
  assert.equal(o.salePrice, 2.79);
  assert.equal(o.originalPrice, 3.49);
  assert.equal(o.discountPercent, 20); // round((3.49-2.79)/3.49*100)
  assert.equal(o.offerText, "Op=Op");
  assert.equal(o.category, Category.FRUIT); // "aardbeien"
  assert.deepEqual({ a: o.contentAmount, u: o.contentUnit }, { a: 0.5, u: "kg" }); // 2 x 250 g
});
