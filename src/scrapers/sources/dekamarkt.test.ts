// Unit tests for the DekaMarkt scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  parseDekaPrice,
  parseDekaContent,
  mapDekaSectionCategory,
  categoryFor,
  parseDutchDate,
  periodFromEndDate,
  parseSingleDayValidity,
  parseOffersPage,
} from "./dekamarkt";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// --- parseDekaPrice (split "3."+"99" spans, comma, "3.-", empty) ------------

test("parseDekaPrice collapses the split euro/cents markup to one number", () => {
  assert.equal(parseDekaPrice("3.99"), 3.99);
  assert.equal(parseDekaPrice(" 3. 99 "), 3.99); // whitespace between spans
  assert.equal(parseDekaPrice("12.49"), 12.49);
  assert.equal(parseDekaPrice("0.75"), 0.75);
  assert.equal(parseDekaPrice("3,99"), 3.99); // comma tolerated
});

test("parseDekaPrice: whole-euro '3.-' and empty/no-digit → 3 / null", () => {
  assert.equal(parseDekaPrice("3.-"), 3);
  assert.equal(parseDekaPrice(""), null);
  assert.equal(parseDekaPrice(null), null);
});

// --- parseDekaContent -------------------------------------------------------

test("parseDekaContent parses pack sizes to a base unit", () => {
  assert.deepEqual(parseDekaContent("Fles 1.5 liter."), { contentAmount: 1.5, contentUnit: "l" });
  assert.deepEqual(parseDekaContent("Blik 25 cl."), { contentAmount: 0.25, contentUnit: "l" });
  assert.deepEqual(parseDekaContent("Doos 15 stuks."), { contentAmount: 15, contentUnit: "stuk" });
  assert.deepEqual(parseDekaContent("Schaal 200 gram."), { contentAmount: 0.2, contentUnit: "kg" });
});

test("parseDekaContent keeps the last number of a range, multiplies 'N x M'", () => {
  assert.deepEqual(parseDekaContent("Stuk 650 - 675 gram."), { contentAmount: 0.675, contentUnit: "kg" });
  assert.deepEqual(parseDekaContent("2 x 250 gram"), { contentAmount: 0.5, contentUnit: "kg" });
  assert.deepEqual(parseDekaContent("Per stuk"), { contentAmount: null, contentUnit: null });
  assert.deepEqual(parseDekaContent(null), { contentAmount: null, contentUnit: null });
});

// --- category ---------------------------------------------------------------

test("mapDekaSectionCategory maps the live headings (and null for mixed aisles)", () => {
  assert.equal(mapDekaSectionCategory("Dranken, Sap, Koffie & Thee"), Category.DRANKEN);
  assert.equal(mapDekaSectionCategory("Bier, wijn & gedistilleerd"), Category.ALCOHOL);
  assert.equal(mapDekaSectionCategory("Vlees(waren), Vis & Vega"), Category.VLEES);
  assert.equal(mapDekaSectionCategory("Kind & Drogisterij"), Category.DROGISTERIJ);
  assert.equal(mapDekaSectionCategory("Huishoud & Huisdieren"), Category.HUISHOUDEN);
  assert.equal(mapDekaSectionCategory("Extra weekend voordeel"), null);
  assert.equal(mapDekaSectionCategory("Koopjesmarkt"), null);
});

test("categoryFor: a name keyword wins over the section, else the section fallback", () => {
  assert.equal(categoryFor("Verse Zalmfilet", null, Category.HOUDBAAR), Category.VIS);
  assert.equal(categoryFor("Onbekend merk", null, Category.DRANKEN), Category.DRANKEN);
  // No keyword and no mapped section → OVERIG (the catch-all), not HOUDBAAR.
  assert.equal(categoryFor("Onbekend merk", null, null), Category.OVERIG);
});

// --- validity ---------------------------------------------------------------

test("parseDutchDate reads abbreviated + full Dutch months", () => {
  assert.equal(ymd(parseDutchDate("t/m ma 10 aug", new Date(2026, 7, 6, 12))!), "2026-08-10");
  assert.equal(ymd(parseDutchDate("alleen op zaterdag 8 augustus", new Date(2026, 7, 6, 12))!), "2026-08-08");
  assert.equal(parseDutchDate("geen datum", new Date()), null);
});

test("periodFromEndDate: Tue→Mon window is [end-6 .. end]", () => {
  const { validFrom, validUntil } = periodFromEndDate(new Date(2026, 7, 10)); // ma 10 aug
  assert.equal(ymd(validFrom), "2026-08-04"); // di
  assert.equal(validFrom.getHours(), 0);
  assert.equal(ymd(validUntil), "2026-08-10");
  assert.equal(validUntil.getHours(), 23);
});

test("parseSingleDayValidity pins a card to its stated day, else null", () => {
  const today = new Date(2026, 7, 6, 12);
  const one = parseSingleDayValidity("max. 2 per klant. Deze aanbieding is alleen geldig op vrijdag 7 augustus", today)!;
  assert.equal(ymd(one.validFrom), "2026-08-07");
  assert.equal(ymd(one.validUntil), "2026-08-07");
  assert.equal(parseSingleDayValidity("max. 2 stuks per klant.", today), null);
  assert.equal(parseSingleDayValidity(null, today), null);
});

// --- parseOffersPage (integration against a representative fixture) ----------

const IMG = "https://web-fileserver.dekamarkt.nl/offers/x.png";

const card = (id: string, dept: boolean, opts: {
  title: string; addition?: string; packaging?: string; chip: string; offer: string; regular?: string;
}) => `
  <article class="product__card" data-product-id="${id}">
    <div class="product__card--image"><img class="image" src="${IMG}?width=190" alt="${opts.title}"></div>
    <div class="product__card--content">
      <p class="title">${opts.title}</p>
      ${opts.addition ? `<span class="addition">${opts.addition}</span>` : ""}
      ${opts.packaging ? `<span class="packaging">${opts.packaging}</span>` : ""}
      <div class="bottom"><div class="price__label price__label--offer"><div class="price__label--offer__box">
        <div class="chip"><span>${opts.chip}</span></div>
        <div class="prices"><div class="prices__offer"><span>${opts.offer.split(".")[0]}.</span><small><span>${opts.offer.split(".")[1] ?? ""}</span></small></div>
        ${opts.regular ? `<span class="regular regular-strike">${opts.regular}</span>` : ""}</div>
      </div></div>
    </div>
  </article>`;

const FIXTURE = `<!doctype html><html><body>
  <header>
    <button class="active">t/m ma 10 aug</button>
    <button>vanaf di 11 aug</button>
  </header>
  <section class="offers__department"><h3>Extra weekend voordeel</h3>
    ${card("136548", true, { title: "Noord Hollandse Kaas", addition: "Stuk 650 - 675 gram.", packaging: "max. 2 stukken per klant. Deze aanbieding is alleen geldig op zaterdag 8 augustus", chip: "actie! 4,99", offer: "4.99", regular: "9.99" })}
    ${card("100001", true, { title: "Müller Müllermilk", addition: "Fles 400 ml.", chip: "1+1 GRATIS", offer: "1.85", regular: "3.70" })}
  </section>
  <section class="offers__department"><h3>Aardappelen, Groente & Fruit</h3>
    ${card("100002", false, { title: "Onbekende Snack", addition: "Per zak.", chip: "2 voor 4,99", offer: "4.99" })}
    ${card("100003", false, { title: "Granarolo Mozzarella", addition: "Bak 125 gram.", chip: "25% KORTING", offer: "1.12", regular: "1.49" })}
  </section>
</body></html>`;

const TODAY = new Date(2026, 7, 6, 12); // do 6 aug 2026

test("parseOffersPage: straight discount computes %, weekend note pins the day", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Noord Hollandse Kaas")!;
  assert.equal(o.salePrice, 4.99);
  assert.equal(o.originalPrice, 9.99);
  assert.equal(o.discountPercent, 50); // round((9.99-4.99)/9.99*100)
  assert.equal(o.offerText, "actie! 4,99");
  assert.equal(o.category, Category.KAAS); // "kaas" in the name
  assert.deepEqual({ a: o.contentAmount, u: o.contentUnit }, { a: 0.675, u: "kg" });
  assert.equal(ymd(o.validFrom), "2026-08-08"); // single-day: za 8 aug
  assert.equal(ymd(o.validUntil), "2026-08-08");
  assert.equal(o.deepLink, null); // DekaMarkt cards carry no product URL
});

test("parseOffersPage: 1+1 GRATIS keeps only salePrice + offerText (no synthetic %)", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Müller Müllermilk")!;
  assert.equal(o.salePrice, 1.85);
  assert.equal(o.originalPrice, null); // the 3.70 strike is a per-unit-after-1+1 figure
  assert.equal(o.discountPercent, null);
  assert.equal(o.offerText, "1+1 GRATIS");
});

test("parseOffersPage: 'N voor P' is multi-buy; section fallback categorises", () => {
  const offers = parseOffersPage(FIXTURE, TODAY);
  const v = offers.find((x) => x.name === "Onbekende Snack")!;
  assert.equal(v.salePrice, 4.99);
  assert.equal(v.originalPrice, null);
  assert.equal(v.discountPercent, null);
  // no name keyword → falls back to the "Aardappelen, Groente & Fruit" section.
  assert.equal(v.category, Category.GROENTE);
  // full weekly window (no single-day note).
  assert.equal(ymd(v.validFrom), "2026-08-04");
  assert.equal(ymd(v.validUntil), "2026-08-10");
});

test("parseOffersPage: 25% KORTING is a real per-unit cut → keeps its %", () => {
  const o = parseOffersPage(FIXTURE, TODAY).find((x) => x.name === "Granarolo Mozzarella")!;
  assert.equal(o.salePrice, 1.12);
  assert.equal(o.originalPrice, 1.49);
  assert.equal(o.discountPercent, 25);
  assert.equal(o.category, Category.KAAS); // "mozzarella"
});
