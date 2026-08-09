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
import { dekamarkt } from "./sources/dekamarkt";
import { gall } from "./sources/gall";
import { plus } from "./sources/plus";
import { vomar } from "./sources/vomar";
import { persistOffers } from "./persist";
import type { Scraper } from "./types";

const SCRAPERS: Scraper[] = [hoogvliet, albertHeijn, jumbo, aldi, lidl, dirk, dekamarkt, gall, plus, vomar];

// Scrapers left OUT of a full run (i.e. when no slug args are given). Vomar's
// OCR/vision folder reader isn't production-ready, so it must not run in the
// scheduled/prod scrape — but it stays in SCRAPERS so it can still be exercised
// explicitly with `npm run db:scrape -- vomar`. Remove the slug here to re-enable.
const DISABLED_BY_DEFAULT = new Set<string>(["vomar"]);

// Freshness assertion (see DAILY_SCRAPE.md §5 G11 / §8). A healthy store always
// returns offers; a store that returns fewer than its floor is almost certainly
// dead — a changed site layout or a blocked request — not a genuinely empty ad.
// When that happens we DON'T persist (an empty scrape must never overwrite a
// store's live offers) and we set a non-zero exit code so the nightly job goes
// RED instead of silently publishing an emptied feed. The exit code below is
// what turns a "green but empty" run into an alert.
//
// Default floor is 1, i.e. any store returning 0 offers fails. Raise a store's
// floor here if you want to also catch a partial collapse (e.g. a scraper that
// normally finds ~250 but returns 3). Keep floors conservative to avoid false
// alarms on a genuinely lighter ad week.
const MIN_OFFERS: Record<string, number> = {};
const DEFAULT_MIN_OFFERS = 1;
const minOffersFor = (slug: string) => MIN_OFFERS[slug] ?? DEFAULT_MIN_OFFERS;

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const slugs = args.filter((a) => !a.startsWith("--"));

  const selected = slugs.length
    ? SCRAPERS.filter((s) => slugs.includes(s.slug))
    : SCRAPERS.filter((s) => !DISABLED_BY_DEFAULT.has(s.slug));

  if (!slugs.length && DISABLED_BY_DEFAULT.size) {
    console.log(`(skipping by default: ${[...DISABLED_BY_DEFAULT].join(", ")} — pass the slug explicitly to run)`);
  }

  if (selected.length === 0) {
    console.error(
      `No matching scrapers for [${slugs.join(", ")}]. Known: ${SCRAPERS.map((s) => s.slug).join(", ")}`,
    );
    process.exit(1);
  }

  // Collected for the end-of-run health summary and the process exit code.
  const threw: string[] = [];
  const staleStores: string[] = [];

  for (const scraper of selected) {
    const started = Date.now();
    console.log(`\n▶ Scraping ${scraper.name} (${scraper.slug})…`);
    try {
      const offers = await scraper.scrape();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  Found ${offers.length} offers in ${secs}s.`);

      // Freshness gate: a below-floor result is a failed scrape, not an empty
      // ad. Skip persisting it (never let it wipe the store's live offers) and
      // mark the run for a non-zero exit so the nightly job alerts.
      const floor = minOffersFor(scraper.slug);
      if (offers.length < floor) {
        console.error(
          `  ✖ FRESHNESS: ${scraper.name} returned ${offers.length} offers (floor ${floor}). ` +
            `Skipping persist so live offers are left intact.`,
        );
        staleStores.push(`${scraper.slug} (${offers.length})`);
        process.exitCode = 1;
        continue;
      }

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
        `  Saved: ${result.created} new, ${result.updated} updated, ${result.expired} past-date removed (${result.products} new products).`,
      );
    } catch (err) {
      console.error(`  ✖ ${scraper.name} failed:`, err);
      threw.push(scraper.slug);
      process.exitCode = 1;
    }
  }

  // End-of-run health summary. This is what a human (or the Actions failure
  // email) scans first: green = every selected store returned a healthy ad.
  const problems = [
    ...(threw.length ? [`errored: ${threw.join(", ")}`] : []),
    ...(staleStores.length ? [`below freshness floor: ${staleStores.join(", ")}`] : []),
  ];
  if (problems.length) {
    console.error(`\n✖ Scrape finished with problems — ${problems.join("; ")}.`);
  } else {
    console.log(`\n✔ All ${selected.length} store(s) healthy.`);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
