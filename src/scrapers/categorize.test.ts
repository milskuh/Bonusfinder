// Unit tests for the shared keyword classifier. Run with `npm test`.
// These lock in the ordering-sensitive rules — especially that VEGETARISCH beats
// the meat/fish/produce buckets, and KOFFIE beats the generic drinks bucket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import { categorize } from "./categorize";

// --- VEGETARISCH: must win over VLEES / VIS / GROENTE despite the animal words
//     embedded in these product names. ---
test("vegetarian imitations beat the meat/fish/produce buckets", () => {
  assert.equal(categorize("Vegetarische kipstukjes"), Category.VEGETARISCH); // vs VLEES (kip)
  assert.equal(categorize("Vegan burger"), Category.VEGETARISCH); // vs VLEES
  assert.equal(categorize("Tofu naturel"), Category.VEGETARISCH);
  assert.equal(categorize("Groenteburger vegetarisch"), Category.VEGETARISCH); // vs GROENTE
  assert.equal(categorize("Vivera plantaardige tonijn"), Category.VEGETARISCH); // brand token, vs VIS
});

test("a real meat product still lands in VLEES (VEGETARISCH isn't over-greedy)", () => {
  assert.equal(categorize("Kipfilet"), Category.VLEES);
  assert.equal(categorize("Rundergehakt"), Category.VLEES);
});

// --- KOFFIE: must win over the DRANKEN/SODA/ONTBIJT block. ---
test("coffee products land in KOFFIE", () => {
  assert.equal(categorize("Koffiepads regular"), Category.KOFFIE);
  assert.equal(categorize("Oploskoffie"), Category.KOFFIE); // explicit compound token
  assert.equal(categorize("Nespresso capsules"), Category.KOFFIE);
  assert.equal(categorize("Douwe Egberts filterkoffie"), Category.KOFFIE);
  // Coffee-only brand names with no "koffie" word are caught by NAME, so we don't
  // have to lean on section hints (the source of the section-label pollution bug).
  assert.equal(categorize("Alle Segafredo"), Category.KOFFIE);
  assert.equal(categorize("Kanis & Gunnink"), Category.KOFFIE);
  assert.equal(categorize("Perla snelfiltermaling"), Category.KOFFIE);
});

test("a broad drinks section keyword in the NAME still classifies on the product itself", () => {
  // Guards the fix for the backfill bug: real classification runs on the product
  // name. A beer named plainly does NOT become KOFFIE just because it shares an
  // aisle with coffee — its heading is never fed to categorize().
  assert.notEqual(categorize("Affligem Blond"), Category.KOFFIE);
  assert.notEqual(categorize("Pickwick thee"), Category.KOFFIE); // tea → DRANKEN, not KOFFIE
});

test("a normal soft drink is unaffected by KOFFIE", () => {
  assert.equal(categorize("Coca-Cola Zero"), Category.SODA);
  assert.equal(categorize("Spa Reine bronwater"), Category.DRANKEN); // water → DRANKEN
});
