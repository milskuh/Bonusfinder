// Seed script — run via `npm run db:seed` (which calls `prisma db seed`).
//
// Seeds ONLY reference data: the list of supermarket chains (name + logo). It
// does NOT create any products, offers, or price history — that real data comes
// exclusively from the scrapers (`npm run db:scrape`). The upserts are
// idempotent and non-destructive, so running this never touches scraped rows or
// User/Favorite data.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Real Dutch supermarket chains. Logos are self-hosted brand assets under
// public/logos/ (referenced by web path, so they resolve the moment a store's
// offers are ingested). Every store here has a scraper except "plus", which is
// kept as a reference row (no local asset yet → keeps its remote logo).
const supermarkets = [
  { slug: "hoogvliet", name: "Hoogvliet", logoUrl: "/logos/hoogvliet.png" },
  { slug: "ah", name: "Albert Heijn", logoUrl: "/logos/ah.svg" },
  { slug: "jumbo", name: "Jumbo", logoUrl: "/logos/jumbo.png" },
  { slug: "lidl", name: "Lidl", logoUrl: "/logos/lidl.svg" },
  { slug: "aldi", name: "Aldi", logoUrl: "/logos/aldi.svg" },
  { slug: "dirk", name: "Dirk", logoUrl: "/logos/dirk.svg" },
  { slug: "dekamarkt", name: "DekaMarkt", logoUrl: "/logos/deka.png" },
  { slug: "gall", name: "Gall & Gall", logoUrl: "/logos/gall.jpg" },
  { slug: "plus", name: "PLUS", logoUrl: "https://logo.clearbit.com/plus.nl" },
];

async function main() {
  console.log("Upserting supermarket reference data…");
  await Promise.all(
    supermarkets.map((s) =>
      db.supermarket.upsert({ where: { slug: s.slug }, update: s, create: s }),
    ),
  );
  console.log(`Done: ${supermarkets.length} supermarkets. Run \`npm run db:scrape\` to load real offers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
