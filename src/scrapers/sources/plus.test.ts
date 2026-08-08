// Unit tests for the PLUS scraper's pure helpers. Run with `npm test`.
// No network: the promotions JSON is an inline fixture shaped like the real
// DataAction response (see plus.discovery.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import {
  mapPlusCategory,
  parsePlusContent,
  parsePlusResponse,
  plusOfferText,
  plusValidity,
  type PlusResponse,
} from "./plus";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// --- mapPlusCategory --------------------------------------------------------

test("mapPlusCategory: aisle → Category, alcohol aisle → ALCOHOL, mixed/non-food → null", () => {
  assert.equal(mapPlusCategory("Wijn, bier, sterke drank"), Category.ALCOHOL);
  assert.equal(mapPlusCategory("Aardappelen, groente, fruit"), Category.GROENTE);
  assert.equal(mapPlusCategory("Diepvries"), Category.DIEPVRIES);
  assert.equal(mapPlusCategory("Wonen, bloemen, service"), null);
  assert.equal(mapPlusCategory("Gratis bezorging"), null);
  assert.equal(mapPlusCategory(undefined), null);
});

// --- plusOfferText ----------------------------------------------------------

test("plusOfferText keeps multi-buy mechanics, drops %/€/price-form labels", () => {
  assert.equal(plusOfferText("1+1 GRATIS"), "1+1 GRATIS");
  assert.equal(plusOfferText("3 VOOR 5.99"), "3 VOOR 5.99");
  assert.equal(plusOfferText("2E HALVE PRIJS"), "2E HALVE PRIJS");
  assert.equal(plusOfferText("25 % KORTING"), null); // carried by the computed %
  assert.equal(plusOfferText("500 GRAM 1.19"), null); // price form, not a mechanic
  assert.equal(plusOfferText(""), null);
});

// --- plusValidity -----------------------------------------------------------

test("plusValidity: Wed→Tue window from the offer's own dates", () => {
  const v = plusValidity("2026-08-05", "2026-08-11");
  assert.equal(ymd(v.validFrom), "2026-08-05");
  assert.equal(ymd(v.validUntil), "2026-08-11");
  assert.equal(v.validUntil.getHours(), 23);
});

// --- parsePlusContent -------------------------------------------------------

test("parsePlusContent: unambiguous sizes only; ranges/multipacks/à → null", () => {
  assert.deepEqual(parsePlusContent("500 GRAM 1.19", ""), { contentAmount: 0.5, contentUnit: "kg" });
  assert.deepEqual(parsePlusContent("", "Schaal 500 gram"), { contentAmount: 0.5, contentUnit: "kg" });
  assert.deepEqual(parsePlusContent("", "Fles 1,5 liter"), { contentAmount: 1.5, contentUnit: "l" });
  assert.deepEqual(parsePlusContent("", "Set 12 blikjes à 33 cl"), { contentAmount: null, contentUnit: null });
  assert.deepEqual(parsePlusContent("", "Schaal en zak 500-1000 gram"), { contentAmount: null, contentUnit: null });
});

// --- parsePlusResponse (integration) ---------------------------------------

const fixture: PlusResponse = {
  data: {
    IsNextWeekPublished: true,
    PromotionOfferList: {
      List: [
        // Free-delivery banner — dropped whole.
        {
          Category: {
            CategoryLabel: "Gratis bezorging",
            Offers: {
              List: [
                {
                  Slug: "4441-101", Name: "Heineken", Brand: "Amstel",
                  NewPrice: "0.0", DisplayInfo_Label: "Gratis bezorging BIJ 2 STUKS",
                  IsFreeDeliveryOffer: true, StartDate: "2026-08-05", EndDate: "2026-08-11",
                },
              ],
            },
          },
          ProductPromotionTiles: { List: [] },
        },
        // Produce: a straight cut + a 1+1, plus a banner tile (a diepvries pizza).
        {
          Category: {
            CategoryLabel: "Aardappelen, groente, fruit",
            Offers: {
              List: [
                {
                  PromotionID: "4441", Offer_Id: "168", Brand: "PLUS", Name: "Druivenmix",
                  Variant: "Schaal 500 gram", DisplayInfo_Label: "",
                  NewPrice: "2.49", PriceOriginal_Lowest: "2.89", PriceOriginal_Highest: "3.29",
                  StartDate: "2026-08-05", EndDate: "2026-08-11",
                  Slug: "4441-168", ImageURL: "//images.ctfassets.net/x/a.png",
                },
                {
                  PromotionID: "4441", Offer_Id: "162", Brand: "Alle PLUS", Name: "Meloenen",
                  DisplayInfo_Label: "1+1 GRATIS",
                  NewPrice: "2.89", PriceOriginal_Lowest: "5.78", PriceOriginal_Highest: "0.0",
                  StartDate: "2026-08-05", EndDate: "2026-08-11", Slug: "4441-162",
                },
              ],
            },
          },
          ProductPromotionTiles: {
            List: [
              {
                PromotionId: "4441", OfferId: "80", ProductName: "Ristorante pizza", Brand: "Dr. Oetker",
                DisplayInfo_Label: "3 VOOR 5.99",
                NewPrice: "5.99", PriceOriginal_Lowest: "9.45", PriceOriginal_Highest: "14.97",
                StartDate: "2026-08-05", EndDate: "2026-08-11", Slug: "4441-80",
                ImageURL: "https://images.ctfassets.net/x/p.png",
              },
            ],
          },
        },
        // Alcohol whose product name is only a brand list → ALCOHOL via aisle fallback.
        {
          Category: {
            CategoryLabel: "Wijn, bier, sterke drank",
            Offers: {
              List: [
                {
                  Brand: "Desperados, Texels en Leffe", Name: "", Variant: "Set 12 blikjes à 33 cl",
                  DisplayInfo_Label: "",
                  NewPrice: "9.99", PriceOriginal_Lowest: "10.99", PriceOriginal_Highest: "11.99",
                  StartDate: "2026-08-05", EndDate: "2026-08-11", Slug: "4441-777",
                },
              ],
            },
          },
          ProductPromotionTiles: { List: [] },
        },
        // REGRESSION GUARD: the aisle label "Kaas, vleeswaren, tapas" contains the
        // substring "vlees" — it must NOT be fed to categorize() or this cheese lands
        // in VLEES. "Heks'nkaas" has no word-start category keyword, so it relies on
        // the mapPlusCategory() fallback to reach KAAS.
        {
          Category: {
            CategoryLabel: "Kaas, vleeswaren, tapas",
            Offers: {
              List: [
                {
                  Brand: "Heks'nkaas", Name: "", DisplayInfo_Label: "50 % KORTING",
                  NewPrice: "1.69", PriceOriginal_Lowest: "3.39", PriceOriginal_Highest: "0.0",
                  StartDate: "2026-08-05", EndDate: "2026-08-11", Slug: "4441-500",
                },
              ],
            },
          },
          ProductPromotionTiles: { List: [] },
        },
      ],
    },
  },
};

test("parsePlusResponse: skips free delivery, maps cuts + multi-buys + tiles + alcohol", () => {
  const offers = parsePlusResponse(fixture);
  assert.equal(offers.length, 5); // free-delivery banner excluded

  const by = (slugTail: string) => offers.find((o) => o.deepLink?.endsWith(slugTail))!;

  // Straight fixed-price cut: sale + lowest original + computed %, no offerText.
  const druiven = by("4441-168");
  assert.equal(druiven.name, "PLUS Druivenmix");
  assert.equal(druiven.category, Category.FRUIT); // "druiven" → FRUIT
  assert.equal(druiven.salePrice, 2.49);
  assert.equal(druiven.originalPrice, 2.89); // the LOWEST "was", never overstated
  assert.equal(druiven.discountPercent, 14); // round((2.89-2.49)/2.89*100)
  assert.equal(druiven.offerText, null);
  assert.deepEqual({ a: druiven.contentAmount, u: druiven.contentUnit }, { a: 0.5, u: "kg" });
  assert.equal(druiven.imageUrl, "https://images.ctfassets.net/x/a.png"); // protocol filled in
  assert.equal(ymd(druiven.validFrom), "2026-08-05");

  // Pure multi-buy: mechanism in offerText, NO synthetic original/percentage.
  const meloen = by("4441-162");
  assert.equal(meloen.salePrice, 2.89);
  assert.equal(meloen.originalPrice, null);
  assert.equal(meloen.discountPercent, null);
  assert.equal(meloen.offerText, "1+1 GRATIS");

  // Banner tile (X-for-Y) parsed like a category offer, deep link sanitised.
  const pizza = by("4441-80");
  assert.equal(pizza.name, "Dr. Oetker Ristorante pizza");
  assert.equal(pizza.category, Category.DIEPVRIES); // "pizza"
  assert.equal(pizza.salePrice, 5.99);
  assert.equal(pizza.originalPrice, null); // "3 VOOR 5.99" is multi-buy → no %
  assert.equal(pizza.offerText, "3 VOOR 5.99");
  assert.equal(pizza.deepLink, "https://www.plus.nl/aanbiedingen/4441-80");

  // Alcohol with a brand-only name lands in ALCOHOL via the aisle fallback.
  const beer = by("4441-777");
  assert.equal(beer.name, "Desperados, Texels en Leffe"); // empty Name → Brand
  assert.equal(beer.category, Category.ALCOHOL);
  assert.equal(beer.salePrice, 9.99);
  assert.equal(beer.discountPercent, 9); // round((10.99-9.99)/10.99*100)
  assert.equal(beer.contentAmount, null); // "à 33 cl" multipack → not the product's own size

  // The cheese in "Kaas, vleeswaren, tapas" must be KAAS, never VLEES.
  const kaas = by("4441-500");
  assert.equal(kaas.name, "Heks'nkaas");
  assert.equal(kaas.category, Category.KAAS);
});
