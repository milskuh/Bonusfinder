// src/scrapers/recategorize.ts
// Targeted backfill for a NEWLY ADDED category: re-run the shared classifier
// (categorize.ts) over every Product already in the DB and file any that now
// resolve to one of the new categories (KOFFIE / VEGETARISCH). Adding rules to
// categorize.ts only affects FUTURE scrapes; existing rows keep the category they
// were filed under when first scraped, and persist.ts only refreshes a product's
// category when it reappears in a current ad — so anything out of season stays
// stale until a run like this.
//
//   tsx src/scrapers/recategorize.ts            # apply the reclassification
//   tsx src/scrapers/recategorize.ts --dry      # preview only, no DB writes
//
// IMPORTANT — why this only moves products INTO the new categories:
// the stored category is often NOT what plain categorize(name, hints) returns,
// because the scrapers layer their own per-source signal on top (AH/Gall/Deka map
// their section names to a Category as a fallback — see mapSectionCategory in
// albert-heijn.ts). Re-running the bare classifier over the whole catalogue would
// DISCARD that signal and wrongly move hundreds of correctly-filed products
// (e.g. section-tagged cheese/alcohol that carries no keyword in its name). So we
// restrict writes to rows whose new category is one of NEW_CATEGORIES — exactly
// the products this migration is meant to rescue — and leave everything else to a
// normal re-scrape (`npm run db:scrape`), which re-applies each source's logic.
//
// Mirrors the `npm run db:scrape --dry` convention (writes by default, --dry to
// preview). Idempotent: a second run with no rule changes moves nothing. Only the
// `category` column on Product is ever touched — offers and price history are left
// alone (category lives on Product).
import { Category } from "@prisma/client";
import { db } from "../lib/db";
import { categorize } from "./categorize";

// The categories this backfill is allowed to move products INTO. Keep this in sync
// with the categories added in the migration that ships alongside it.
const NEW_CATEGORIES: ReadonlySet<Category> = new Set([Category.KOFFIE, Category.VEGETARISCH]);

async function main() {
  const dry = process.argv.slice(2).includes("--dry");

  const products = await db.product.findMany({
    select: { id: true, name: true, brand: true, subcategory: true, category: true },
  });
  console.log(`Loaded ${products.length} products.${dry ? " (dry run — no writes)" : ""}`);

  // Recompute with the same inputs the scrapers feed the classifier: the product
  // name plus its subcategory/brand hints. Only keep a move when it lands in a new
  // category (see the header note) and actually changes the row.
  const moves = products
    .map((p) => ({ p, next: categorize(p.name, [p.subcategory, p.brand]) }))
    .filter(({ p, next }) => next !== p.category && NEW_CATEGORIES.has(next));

  // Per-transition tally, e.g. "VLEES → VEGETARISCH: 12".
  const transitions = moves.reduce<Record<string, number>>((acc, { p, next }) => {
    const key = `${p.category} → ${next}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  if (moves.length === 0) {
    console.log("Nothing to reclassify — every product already matches the rules.");
    return;
  }

  console.log(`\n${moves.length} product(s) will move:`);
  console.table(transitions);

  // Where the two new categories are drawing from — the headline the user asked for.
  const into = (c: Category) => moves.filter((m) => m.next === c).length;
  console.log(`  → KOFFIE: ${into(Category.KOFFIE)}   → VEGETARISCH: ${into(Category.VEGETARISCH)}`);

  // A few examples so the reclassification can be eyeballed before trusting it.
  console.log("\nSample:");
  console.table(
    moves.slice(0, 12).map(({ p, next }) => ({
      name: p.name.slice(0, 40),
      from: p.category,
      to: next,
    })),
  );

  if (dry) {
    console.log("\nDry run: no changes written. Re-run without --dry to apply.");
    return;
  }

  let updated = 0;
  for (const { p, next } of moves) {
    await db.product.update({ where: { id: p.id }, data: { category: next } });
    updated++;
  }
  console.log(`\nDone. Reclassified ${updated} product(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
