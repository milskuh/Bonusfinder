// src/scrapers/categorize.fixtures.ts
// The permanent categorisation contract. Every misclassification the user reports
// becomes a row here, so the fix can never silently regress. The test in
// categorize.fixtures.test.ts runs categorize() over every row and asserts the
// expected Category.
//
// `expected` is a Category enum value (as a string). `source`/`section` are threaded
// into categorize()'s options so a row can exercise the source-trust tier.
import type { Category } from "@prisma/client";

export interface CategoryFixture {
  name: string;
  brand?: string;
  source?: string;
  section?: string;
  expected: Category; // a Category enum value
  /** Short note on why this row exists / what it guards. */
  note?: string;
}

export const CATEGORY_FIXTURES: readonly CategoryFixture[] = [
  // --- The seven reported misclassifications (see FIX_CATEGORIZATION.md §1) -----
  { name: "Brabantia Nova koekenpan 28cm", expected: "HUISHOUDEN", note: "was Snacks: 'koek' → koekenpan" },
  { name: "Nexxt ijscrusher en slushymaker", expected: "HUISHOUDEN", note: "was Diepvries: 'ijs' → ijscrusher" },
  { name: "Alle Waterwipes en Happy Earth", expected: "BABY_KIND", note: "was Dranken: 'water' → waterwipes" },
  { name: "Nexxt Telescopische waterborstel 7 meter", expected: "HUISHOUDEN", note: "was Dranken: 'water' → waterborstel" },
  { name: "Benson spanband 5 meter", expected: "HUISHOUDEN", note: "was Dranken: 'spa' → spanband" },
  { name: "Alle Cheetos, Hamka's, Bugles en Wokkels 100 gram", expected: "SNACKS_SNOEP", note: "was Vlees: 'ham' → Hamka's" },
  { name: "STELZ Hard Lemonade Strawberry Cassis", source: "gall", expected: "ALCOHOL", note: "was Frisdrank: SODA beat ALCOHOL" },
  { name: "Bombay Sapphire & Tonic", source: "gall", expected: "ALCOHOL", note: "was Frisdrank: 'tonic'" },
  { name: "Gin Tonic", source: "gall", expected: "ALCOHOL", note: "was Frisdrank: 'tonic'" },
  { name: "Alle Biodermal en Vision zonbescherming", expected: "DROGISTERIJ", note: "was Vis: 'vis' → Vision" },

  // These same alcohol cases must ALSO resolve on the name alone (no source), via
  // the reordered ALCOHOL-before-SODA rules + spirit phrases/brands.
  { name: "STELZ Hard Lemonade Strawberry Cassis", expected: "ALCOHOL", note: "name-only: 'hard lemonade' + 'stelz'" },
  { name: "Bombay Sapphire & Tonic", expected: "ALCOHOL", note: "name-only: 'bombay sapphire'" },
  { name: "Gin Tonic", expected: "ALCOHOL", note: "name-only: 'gin' word + 'gin tonic' phrase" },

  // --- Control rows: currently-correct classifications a refactor must not break --
  { name: "Kipfilet naturel", expected: "VLEES" },
  { name: "Rundergehakt 500 gram", expected: "VLEES" },
  { name: "Verse aardbeien 400 gram", expected: "FRUIT" },
  { name: "Coca-Cola Zero 1,5 L", expected: "SODA" },
  { name: "Ginger ale", expected: "SODA", note: "'gin' must NOT drag this into ALCOHOL" },
  { name: "Halfvolle melk", expected: "ZUIVEL" },
  { name: "Goudse belegen 48+", expected: "KAAS" },
  { name: "Volkorenbrood heel", expected: "BROOD_BANKET" },
  { name: "Spa Reine bronwater", expected: "DRANKEN" },
  { name: "Douwe Egberts filterkoffie", expected: "KOFFIE" },
  { name: "Heineken pilsener krat", expected: "ALCOHOL" },
  { name: "Tomatensoep", expected: "HOUDBAAR", note: "suffix '*soep'" },
  { name: "Tofu naturel", expected: "VEGETARISCH" },
  { name: "Rode ui", expected: "GROENTE", note: "'ui' whole-word onion" },
  { name: "Champignons 250 gram", expected: "GROENTE", note: "'ham' must NOT match champignon" },
  { name: "Spaghetti Bolognese", expected: "PASTA_RIJST", note: "'spa' must NOT drag this into DRANKEN" },
];
