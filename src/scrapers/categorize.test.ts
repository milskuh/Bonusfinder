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

// --- Regression: category filter bugs reported from the live feed (2026-08-09).
//     Each product was showing under the wrong filter chip; the comment names the
//     wrong bucket it used to land in and the root cause. ---

test("beer compounds land in ALCOHOL, not GROENTE (word-start 'bier' missed them)", () => {
  // "Craftbier" has no word-START "bier"; the substring token "*bier" now catches it.
  assert.equal(categorize("Craftbier"), Category.ALCOHOL);
  assert.equal(categorize("Witbier"), Category.ALCOHOL);
  assert.equal(categorize("Speciaalbier"), Category.ALCOHOL);
  assert.equal(categorize("Bok bier"), Category.ALCOHOL);
  // …and the Aldi brand hint "Uiltje" must NOT drag it into GROENTE via "ui".
  assert.equal(categorize("Craftbier", ["Uiltje"]), Category.ALCOHOL);
});

test("'ui' (onion) is a whole-word match — brands/dishes starting 'ui' don't become GROENTE", () => {
  assert.equal(categorize("Rode ui"), Category.GROENTE); // real onion still matches
  assert.equal(categorize("Uien"), Category.GROENTE); // plural keeps its word-start rule
  assert.notEqual(categorize("Uiltje"), Category.GROENTE); // beer brand ≠ onion
  assert.notEqual(categorize("Uitsmijter"), Category.GROENTE); // egg dish ≠ onion
});

test("the 'Gouda's Glorie' sauce brand lands in HOUDBAAR, not KAAS", () => {
  assert.equal(categorize("Mad sauce of Gouda's Glorie saus"), Category.HOUDBAAR);
  assert.equal(categorize("Gouda's Glorie samurai saus"), Category.HOUDBAAR);
  // Real Gouda cheese still reaches KAAS — it carries "kaas" / "belegen".
  assert.equal(categorize("Goudse kaasstukken"), Category.KAAS);
  assert.equal(categorize("Goudse belegen 48+"), Category.KAAS);
});

test("Oreo classifies as SNACKS_SNOEP from the name (not via a bakery section hint)", () => {
  // Dirk lists Oreo under "Brood, beleg & koek", whose section fallback is
  // BROOD_BANKET. A name keyword must win so the fallback never fires.
  assert.equal(categorize("Oreo enrobed"), Category.SNACKS_SNOEP);
  assert.equal(categorize("Oreo enrobed", ["Brood, beleg & koek"]), Category.SNACKS_SNOEP);
});

test("pest control is HUISHOUDEN — a marketing subtitle can't pull it into a food bucket", () => {
  assert.equal(categorize("Insectenverdelger"), Category.HUISHOUDEN);
  // The reported bug: a descriptive hint mentioning "groente" beat the name.
  // Name-first classification means the name now wins.
  assert.equal(
    categorize("Insectenverdelger", ["Beschermt groente en fruit in de tuin"]),
    Category.HUISHOUDEN,
  );
  assert.equal(categorize("Muggenstekker navulling"), Category.HUISHOUDEN);
});

test("truly unmatched products fall back to OVERIG, not HOUDBAAR", () => {
  // Nothing in the name (or hints) matches any keyword → OVERIG catch-all.
  assert.equal(categorize("Onbekend cadeauartikel"), Category.OVERIG);
  assert.equal(categorize("Xyzzy set", ["diverse soorten"]), Category.OVERIG);
  // A real HOUDBAAR keyword is a definite pantry answer — it stays HOUDBAAR,
  // proving OVERIG is only the no-match fallback, not a rename of HOUDBAAR.
  assert.equal(categorize("Ketchup"), Category.HOUDBAAR);
  // Suffix compounds ("*saus"/"*soep"/"*olie") that a word-start rule would miss
  // still reach pantry rather than OVERIG.
  assert.equal(categorize("Barbecuesaus"), Category.HOUDBAAR);
  assert.equal(categorize("Tomatensoep"), Category.HOUDBAAR);
  assert.equal(categorize("Olijfolie extra vierge"), Category.HOUDBAAR);
  // …but the "oliebol" pastry is bakery, not caught by "*olie".
  assert.equal(categorize("Oliebollen naturel"), Category.BROOD_BANKET);
});

test("suffix-compound meat/cheese/veg reach their real bucket, not OVERIG", () => {
  // The category word is a SUFFIX ("*worst"/"*karbonade") or plural/compound that
  // a word-start rule missed, so these used to fall through to the catch-all.
  assert.equal(categorize("Grillworst of ossenworst"), Category.VLEES);
  assert.equal(categorize("Schouder- of ribkarbonade"), Category.VLEES);
  assert.equal(categorize("Gegrilde beenham"), Category.VLEES);
  assert.equal(categorize("Saucijzen"), Category.VLEES);
  assert.equal(categorize("Strooikaas"), Category.KAAS);
  assert.equal(categorize("Bospeen"), Category.GROENTE);
  assert.equal(categorize("Rauwkost"), Category.GROENTE);
  // Guard: "*ham" was NOT used (it would hit "champignon"), so a mushroom is
  // produce, never meat.
  assert.equal(categorize("Champignons"), Category.GROENTE);
  assert.notEqual(categorize("Kastanjechampignons"), Category.VLEES);
});

test("name-first: a name keyword beats a hint from an earlier-priority rule", () => {
  // A clean cheese name stays KAAS even if a hint mentions an earlier category.
  assert.equal(categorize("Jong belegen plakken", ["Vlees, vis & vega"]), Category.KAAS);
  // A name with no keyword still falls back to the hint (unchanged behaviour).
  assert.equal(categorize("Assortiment", ["diepvries pizza"]), Category.DIEPVRIES);
});
