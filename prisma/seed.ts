// Seed script — run via `npm run db:seed` (which calls `prisma db seed`).
//
// Seeds ONLY reference data: the list of supermarket chains (name + logo). It
// does NOT create any products, offers, or price history — that real data comes
// exclusively from the scrapers (`npm run db:scrape`). The upserts are
// idempotent and non-destructive, so running this never touches scraped rows or
// User/Favorite data.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Real Dutch supermarket chains. Only "hoogvliet" is backed by a scraper today
// (see src/scrapers/); the others are kept as reference rows so their name/logo
// are ready when a scraper is added for them. They carry no offers until then.
const supermarkets = [
  { slug: "hoogvliet", name: "Hoogvliet", logoUrl: "https://logo.clearbit.com/hoogvliet.com" },
  { slug: "ah", name: "Albert Heijn", logoUrl: "https://logo.clearbit.com/ah.nl" },
  { slug: "jumbo", name: "Jumbo", logoUrl: "https://logo.clearbit.com/jumbo.com" },
  { slug: "lidl", name: "Lidl", logoUrl: "https://logo.clearbit.com/lidl.nl" },
  { slug: "aldi", name: "Aldi", logoUrl: "https://logo.clearbit.com/aldi.nl" },
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
