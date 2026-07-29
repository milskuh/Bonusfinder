// src/scrapers/translate-run.ts
// CLI: fill in English product names (Product.nameEn) for any product that
// doesn't have one yet, using Claude. Run via `npm run db:translate`.
//
// Idempotent: only untranslated products are sent, so re-running after a scrape
// translates just the new ones. Requires ANTHROPIC_API_KEY in the environment.
import { db } from "../lib/db";
import { hasApiKey, translateToEnglish } from "./translate";

async function main() {
  if (!hasApiKey()) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example), then re-run `npm run db:translate`.",
    );
    process.exit(1);
  }

  const pending = await db.product.findMany({
    where: { nameEn: null },
    select: { id: true, name: true },
  });

  if (pending.length === 0) {
    console.log("All product names are already translated. Nothing to do.");
    return;
  }

  console.log(`Translating ${pending.length} product names to English…`);
  const translations = await translateToEnglish(
    pending.map((p) => p.name),
    (done, total) => console.log(`  ${done}/${total}…`),
  );

  await db.$transaction(
    pending.map((p, i) =>
      db.product.update({ where: { id: p.id }, data: { nameEn: translations[i] } }),
    ),
  );

  console.log(`Done: translated ${pending.length} product names.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
