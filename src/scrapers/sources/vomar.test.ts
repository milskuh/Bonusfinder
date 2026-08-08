// Unit tests for the Vomar folder-reading helpers. Run with `npm test`.
// No network / no AI: fixtures are inline (a resolved-publication HTML snippet, a
// Publitas OCR page-text sample, and a vision-JSON sample). See vomar.discovery.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  isoWeekMonday,
  offersFromExtractedItems,
  offersFromHotspots,
  offersFromPublitasText,
  parseLeafletPrice,
  periodFromWeek,
  resolvePublication,
} from "./vomar";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const V = { validFrom: new Date(2026, 7, 6), validUntil: new Date(2026, 7, 9, 23, 59, 59) };

// --- validity ---------------------------------------------------------------

test("isoWeekMonday: week 32 of 2026 is Monday 3 August", () => {
  assert.equal(ymd(isoWeekMonday(2026, 32)), "2026-08-03");
});

test("periodFromWeek: weekend folder → Thu–Sun; weekly folder → Wed–Tue", () => {
  const today = new Date(2026, 7, 8);
  const weekend = periodFromWeek(32, true, today);
  assert.equal(ymd(weekend.validFrom), "2026-08-06"); // Thu
  assert.equal(ymd(weekend.validUntil), "2026-08-09"); // Sun
  const weekly = periodFromWeek(32, false, today);
  assert.equal(ymd(weekly.validFrom), "2026-08-05"); // Wed
  assert.equal(ymd(weekly.validUntil), "2026-08-11"); // Tue
});

// --- resolvePublication -----------------------------------------------------

const pubHtml = `
  <html><head>
  <link rel="canonical" href="https://view.publitas.com/folder-deze-week/online-weekendfolder-week-32/">
  </head><body>
  <script>window.cfg = {"numPages":39,"id":3289627};</script>
  <img src="https://view.publitas.com/resize/rev-1/abc/fit-in/1118x2290/filters:quality(90)/production-revolution-publitas-com/96403/3289627/pages/uuid-downscaled.jpg">
  </body></html>`;

test("resolvePublication: ids, page count and a weekend validity window", () => {
  const r = resolvePublication(pubHtml, new Date(2026, 7, 8));
  assert.equal(r.gId, "96403");
  assert.equal(r.pId, "3289627");
  assert.equal(r.pageCount, 39);
  assert.equal(ymd(r.validFrom), "2026-08-06"); // "weekend" slug → Thu
  assert.equal(ymd(r.validUntil), "2026-08-09"); // Sun
});

// --- parseLeafletPrice ------------------------------------------------------

test("parseLeafletPrice: decimals and the '1.-' whole-euro form", () => {
  assert.equal(parseLeafletPrice("2.79"), 2.79);
  assert.equal(parseLeafletPrice("1,49"), 1.49);
  assert.equal(parseLeafletPrice("1.-"), 1);
  assert.equal(parseLeafletPrice("€ 3.50"), 3.5);
  assert.equal(parseLeafletPrice("1.5"), null); // needs 2 decimals or the .- form
  assert.equal(parseLeafletPrice("6 aug"), null);
});

// --- offersFromPublitasText (Tier 2) ---------------------------------------

test("offersFromPublitasText: emits name+price tiles incl. a multi-buy, skips noise", () => {
  const text = [
    "Robijn wasmiddel",
    "2 voor 9.99",
    "9.99",
    "6 aug",
    "Zalmfilet",
    "Per 100 gram",
    "4.99",
  ].join("\n");
  const offers = offersFromPublitasText(text, V);
  assert.equal(offers.length, 2);

  const was = offers[0];
  assert.equal(was.name, "Robijn wasmiddel");
  assert.equal(was.category, Category.HUISHOUDEN);
  assert.equal(was.salePrice, 9.99);
  assert.equal(was.offerText, "2 voor 9.99");
  assert.equal(was.discountPercent, null); // multi-buy → no synthetic %
  assert.equal(ymd(was.validFrom), "2026-08-06");

  const zalm = offers[1];
  assert.equal(zalm.name, "Zalmfilet"); // "Per 100 gram" dropped as noise
  assert.equal(zalm.category, Category.VIS);
  assert.equal(zalm.salePrice, 4.99);
  assert.equal(zalm.offerText, null);
});

// --- offersFromExtractedItems (Tier 3 vision/OCR JSON) ---------------------

test("offersFromExtractedItems: maps clean rows, skips malformed/nameless ones", () => {
  const items = [
    { name: "AH Biologische melk", salePrice: 1.29, originalPrice: 1.79 },
    { name: "Chips naturel", offerText: "1+1 gratis" }, // price-less promo, kept via mechanism
    { name: "", salePrice: 2 }, // no name → skip
    { salePrice: 3 }, // no name → skip
    { name: "Kapotte rij", salePrice: "nan" }, // bad price + no mechanism → skip
  ];
  const offers = offersFromExtractedItems(items, V);
  assert.equal(offers.length, 2);

  const melk = offers[0];
  assert.equal(melk.category, Category.ZUIVEL);
  assert.equal(melk.salePrice, 1.29);
  assert.equal(melk.originalPrice, 1.79);
  assert.equal(melk.discountPercent, 28); // round((1.79-1.29)/1.79*100)

  const chips = offers[1];
  assert.equal(chips.category, Category.SNACKS_SNOEP);
  assert.equal(chips.salePrice, null);
  assert.equal(chips.offerText, "1+1 gratis");
});

test("offersFromExtractedItems: non-array input → []", () => {
  assert.deepEqual(offersFromExtractedItems(null, V), []);
  assert.deepEqual(offersFromExtractedItems("oops", V), []);
});

// --- offersFromHotspots (Tier 1) -------------------------------------------

test("offersFromHotspots: maps product hotspots, ignores external links / empties", () => {
  assert.deepEqual(offersFromHotspots([], V), []);
  assert.deepEqual(offersFromHotspots([{ type: "externalLink", url: "https://x" }], V), []);
  const offers = offersFromHotspots(
    [{ type: "product", product: { title: "Testartikel", price: 2.5 } }],
    V,
  );
  assert.equal(offers.length, 1);
  assert.equal(offers[0].name, "Testartikel");
  assert.equal(offers[0].salePrice, 2.5);
});
