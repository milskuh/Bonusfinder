// Unit tests for the Jumbo scraper's pure helpers. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  unflattenNuxtData,
  pickPromoTag,
  parseJumboPrice,
  promotionToOffer,
  type JumboPromotion,
} from "./jumbo";

// --- devalue unflatten -------------------------------------------------------

test("unflattenNuxtData resolves index references (incl. shared values)", () => {
  // root(0) -> { a: 1, b: 2 }; 1 -> "x"; 2 -> [1, 3]; 3 -> "y"
  // Note b reuses index 1 ("x"), the whole point of the flat form.
  const flat = [{ a: 1, b: 2 }, "x", [1, 3], "y"];
  assert.deepEqual(unflattenNuxtData(flat), { a: "x", b: ["x", "y"] });
});

// --- pickPromoTag ------------------------------------------------------------

test("pickPromoTag skips channel modifiers", () => {
  assert.equal(pickPromoTag([{ text: "4,00 korting" }, { text: "Alleen in de slijterij" }]), "4,00 korting");
  assert.equal(pickPromoTag([{ text: "Alleen online" }, { text: "1+1 gratis" }]), "1+1 gratis");
  assert.equal(pickPromoTag([{ text: "1+1 gratis" }]), "1+1 gratis");
});

test("pickPromoTag returns null when only channel tags are present", () => {
  assert.equal(pickPromoTag([{ text: "Alleen online" }]), null);
  assert.equal(pickPromoTag([]), null);
  assert.equal(pickPromoTag(undefined), null);
});

// --- parseJumboPrice ---------------------------------------------------------

test("parseJumboPrice reads fixed and bundle prices", () => {
  assert.equal(parseJumboPrice("voor 1,99"), 1.99);
  assert.equal(parseJumboPrice("Voor 0,89"), 0.89);
  assert.equal(parseJumboPrice("2 voor 6,00"), 6);
  assert.equal(parseJumboPrice("4 voor 10,00"), 10);
});

test("parseJumboPrice returns null for deals with no single price", () => {
  assert.equal(parseJumboPrice("1+1 gratis"), null);
  assert.equal(parseJumboPrice("2+1 gratis"), null);
  assert.equal(parseJumboPrice("25% korting"), null);
  assert.equal(parseJumboPrice("1,00 korting"), null);
  assert.equal(parseJumboPrice("2e halve prijs"), null);
  assert.equal(parseJumboPrice(null), null);
});

// --- promotionToOffer --------------------------------------------------------

const base: JumboPromotion = {
  __typename: "Promotion",
  id: "3018893",
  title: "Alle Pampers",
  group: "Week",
  active: true,
  hidden: false,
  image: "https://www.jumbo.com/img/pampers.png",
  url: "/aanbiedingen/alle-pampers/3018893",
  start: { iso: "2026-07-29T00:01:00+02:00" },
  end: { iso: "2026-08-11T23:59:59+02:00" },
  tags: [{ text: "1+1 gratis" }],
};

test("promotionToOffer maps a multi-buy tile (no fabricated price)", () => {
  const offer = promotionToOffer(base)!;
  assert.equal(offer.name, "Alle Pampers");
  assert.equal(offer.offerText, "1+1 gratis");
  assert.equal(offer.salePrice, null);
  assert.equal(offer.originalPrice, null);
  assert.equal(offer.discountPercent, null);
  assert.equal(offer.category, Category.BABY_KIND); // "pampers" keyword
  assert.equal(offer.deepLink, "https://www.jumbo.com/aanbiedingen/alle-pampers/3018893");
  assert.equal(offer.imageUrl, "https://www.jumbo.com/img/pampers.png");
  assert.equal(offer.validFrom.toISOString().slice(0, 10), "2026-07-28"); // 00:01 +02:00 → 22:01Z prev day
  assert.equal(offer.validUntil.toISOString().slice(0, 10), "2026-08-11");
});

test("promotionToOffer uses the url slug as a category hint", () => {
  // Title alone has no keyword; the deep-link slug ("wasmiddel") supplies it.
  const offer = promotionToOffer({
    ...base,
    title: "Alle Robijn",
    url: "/aanbiedingen/alle-robijn-wasmiddel/3018832",
  })!;
  assert.equal(offer.category, Category.HUISHOUDEN);
});

test("promotionToOffer sets salePrice for a fixed-price tag", () => {
  const offer = promotionToOffer({ ...base, tags: [{ text: "voor 1,99" }] })!;
  assert.equal(offer.salePrice, 1.99);
  assert.equal(offer.offerText, "voor 1,99");
  assert.equal(offer.originalPrice, null);
});

test("promotionToOffer sets the bundle price for N-voor-P", () => {
  const offer = promotionToOffer({ ...base, tags: [{ text: "2 voor 6,00" }] })!;
  assert.equal(offer.salePrice, 6);
  assert.equal(offer.offerText, "2 voor 6,00");
});

test("promotionToOffer skips season-long, inactive, hidden, and deal-less tiles", () => {
  assert.equal(promotionToOffer({ ...base, group: "Seizoen" }), null);
  assert.equal(promotionToOffer({ ...base, active: false }), null);
  assert.equal(promotionToOffer({ ...base, hidden: true }), null);
  assert.equal(promotionToOffer({ ...base, tags: [{ text: "Alleen online" }] }), null);
  assert.equal(promotionToOffer({ ...base, title: "  " }), null);
});

test("promotionToOffer falls back to a 7-day window when dates are missing", () => {
  const today = new Date("2026-07-30T12:00:00Z");
  const offer = promotionToOffer({ ...base, start: null, end: null }, today)!;
  assert.equal(offer.validFrom.getTime(), today.getTime());
  assert.equal(offer.validUntil.getTime(), today.getTime() + 7 * 864e5);
});
