// src/scrapers/purge-store.ts
// One-off maintenance: remove ALL data for a single supermarket (by slug) — its
// Offers and PriceHistory (deleted via the Supermarket onDelete: Cascade) and the
// Supermarket row itself. Products are shared across stores (they have no
// supermarketId), so they're left in place; any left with zero offers simply stop
// appearing in the feed.
//
// Use when a store is retired, or when a disabled scraper left stale offers behind
// that must not linger — e.g. Vomar: disabled in run.ts, but 65 *upcoming* offers
// remained in the DB and kept it in the store-filter (getActiveSupermarkets only
// checks validUntil, so future-dated offers still count) and would surface as real
// deals next week.
//
//   npm run db:purge-store -- vomar           # DRY RUN — show what would be deleted
//   npm run db:purge-store -- vomar --apply   # actually delete
//
// DRY by default because this is destructive. Acts on whatever database your env
// (DATABASE_URL) points at — make sure that's the intended (prod) database.
import { db } from "../lib/db";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const slug = args.find((a) => !a.startsWith("--"));

  if (!slug) {
    console.error("Usage: npm run db:purge-store -- <slug> [--apply]");
    process.exit(1);
  }

  const store = await db.supermarket.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!store) {
    console.log(`No supermarket with slug "${slug}" — nothing to do.`);
    return;
  }

  const [offers, priceHistory] = await Promise.all([
    db.offer.count({ where: { supermarketId: store.id } }),
    db.priceHistory.count({ where: { supermarketId: store.id } }),
  ]);

  console.log(
    `Store "${slug}" (${store.name}): ${offers} offer(s), ${priceHistory} price-history row(s)` +
      `${apply ? "" : " — DRY RUN, nothing deleted"}.`,
  );

  if (!apply) {
    console.log("Re-run with --apply to delete the store (its offers + price history cascade).");
    return;
  }

  // Deleting the Supermarket cascades to its Offers + PriceHistory (onDelete:
  // Cascade in schema.prisma). Shared Products are intentionally left untouched.
  await db.supermarket.delete({ where: { id: store.id } });
  console.log(`Deleted "${slug}" + ${offers} offer(s) + ${priceHistory} price-history row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
