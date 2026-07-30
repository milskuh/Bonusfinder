// src/scrapers/run.ts
// CLI entry point for the scrapers. Run via `npm run db:scrape`.
//
//   npm run db:scrape                 # run every source, write to the DB
//   npm run db:scrape -- hoogvliet    # run one source by slug
//   npm run db:scrape -- --dry        # scrape + print a summary, no DB writes
//
// Flags and slugs can be combined, e.g. `-- hoogvliet --dry`.
import { hoogvliet } from "./sources/hoogvliet";
import { albertHeijn } from "./sources/albert-heijn";
import { jumbo } from "./sources/jumbo";
import { aldi } from "./sources/aldi";
import { lidl } from "./sources/lidl";
import { dirk } from "./sources/dirk";
import { persistOffers } from "./persist";
import type { Scraper } from "./types";

const SCRAPERS: Scraper[] = [hoogvliet, albertHeijn, jumbo, aldi, lidl, dirk];

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const slugs = args.filter((a) => !a.startsWith("--"));

  const selected = slugs.length
    ? SCRAPERS.filter((s) => slugs.includes(s.slug))
    : SCRAPERS;

  if (selected.length === 0) {
    console.error(
      `No matching scrapers for [${slugs.join(", ")}]. Known: ${SCRAPERS.map((s) => s.slug).join(", ")}`,
    );
    process.exit(1);
  }

  for (const scraper of selected) {
    const started = Date.now();
    console.log(`\n▶ Scraping ${scraper.name} (${scraper.slug})…`);
    try {
      const offers = await scraper.scrape();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  Found ${offers.length} offers in ${secs}s.`);

      if (dry) {
        const byCategory = offers.reduce<Record<string, number>>((acc, o) => {
          acc[o.category] = (acc[o.category] ?? 0) + 1;
          return acc;
        }, {});
        console.table(byCategory);
        console.log(
          offers.slice(0, 8).map((o) => ({
            name: o.name.slice(0, 40),
            cat: o.category,
            sale: o.salePrice,
            was: o.originalPrice,
            "-%": o.discountPercent,
          })),
        );
        continue;
      }

      const result = await persistOffers(scraper, offers);
      console.log(
        `  Saved: ${result.offers} offers (${result.products} new products).`,
      );
    } catch (err) {
      console.error(`  ✖ ${scraper.name} failed:`, err);
      process.exitCode = 1;
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
