// src/scrapers/categories-audit.ts
// Read-only audit of how products are currently categorised, so a stray is easy to
// spot and feed straight into categorize.fixtures.ts (or pin as an override). NEVER
// writes.
//
//   npm run db:categories:audit               # per-category counts + a small sample
//   npm run db:categories:audit -- VLEES      # dump every product in one category
//   npm run db:categories:audit -- VLEES 50   # …capped at 50 rows
//   npm run db:categories:audit -- --overrides # list the manual category pins
//
// When a row looks wrong: if a rule can fix it cleanly, add a fixture + fix the
// rule; otherwise pin a CategoryOverride. Either way it can never regress.
//
// The `categorySource` provenance column (source | rule | llm | manual) tells you
// WHICH lever to pull. It only exists once the §7 migration is applied; until then
// this script degrades gracefully and prints "—" for it.
import { Category } from "@prisma/client";
import { db } from "../lib/db";
import { categorize } from "./categorize";

type Row = {
  name: string;
  brand: string | null;
  subcategory: string | null;
  category: Category;
  categorySource: string | null; // null when the column isn't there yet (pre-migration)
  stores: string[];
};

/**
 * Load products (optionally one category). Tries to read `categorySource`; if the
 * column doesn't exist yet (migration not applied) it retries without it, so the
 * audit is usable in both states.
 */
async function loadRows(wanted: Category | null): Promise<Row[]> {
  const base = {
    where: wanted ? { category: wanted } : undefined,
    orderBy: [{ category: "asc" as const }, { name: "asc" as const }],
  };
  const offersSel = { offers: { select: { supermarket: { select: { slug: true } } } } };
  const shape = (p: {
    name: string;
    brand: string | null;
    subcategory: string | null;
    category: Category;
    categorySource?: string;
    offers: { supermarket: { slug: string } }[];
  }): Row => ({
    name: p.name,
    brand: p.brand,
    subcategory: p.subcategory,
    category: p.category,
    categorySource: p.categorySource ?? null,
    stores: [...new Set(p.offers.map((o) => o.supermarket.slug))].sort(),
  });

  try {
    const rows = await db.product.findMany({
      ...base,
      select: { name: true, brand: true, subcategory: true, category: true, categorySource: true, ...offersSel },
    });
    return rows.map(shape);
  } catch {
    // Pre-migration: `categorySource` doesn't exist. Retry without it.
    const rows = await db.product.findMany({
      ...base,
      select: { name: true, brand: true, subcategory: true, category: true, ...offersSel },
    });
    return rows.map(shape);
  }
}

async function listOverrides() {
  try {
    const pins = await db.categoryOverride.findMany({ orderBy: { updatedAt: "desc" } });
    console.log(`\n${pins.length} manual category override(s):\n`);
    for (const p of pins) {
      console.log(`  ${p.productMatchKey} → ${p.category}${p.note ? `  (${p.note})` : ""}`);
    }
    if (pins.length === 0) console.log("  (none yet — pin one by inserting a CategoryOverride row)");
  } catch {
    console.log("CategoryOverride table not found — apply the §7 migration first.");
  }
}

async function main() {
  const [arg, limitArg] = process.argv.slice(2);

  if (arg === "--overrides") {
    await listOverrides();
    return;
  }

  const wanted = arg ? (arg.toUpperCase() as Category) : null;
  if (wanted && !(wanted in Category)) {
    console.error(`Unknown category "${arg}". Valid: ${Object.keys(Category).join(", ")}`);
    process.exit(1);
  }
  const limit = limitArg ? Number(limitArg) : wanted ? 500 : 8;

  const rows = await loadRows(wanted);

  if (wanted) {
    // Single-category dump. Flag rows whose NAME alone would classify elsewhere —
    // the most likely strays. `categorySource` tells you how the stored value was
    // decided (so you know whether to fix a rule, a section map, or pin it).
    console.log(`\n${wanted}: ${rows.length} product(s)\n`);
    for (const r of rows.slice(0, limit)) {
      const byName = categorize(r.name);
      const flag = byName !== wanted ? `  ⚠ name→${byName}` : "";
      const src = r.categorySource ? ` {${r.categorySource}}` : "";
      const stores = r.stores.length ? ` [${r.stores.join(",")}]` : "";
      console.log(`  ${r.name}${r.brand ? ` — ${r.brand}` : ""}${src}${stores}${flag}`);
    }
    if (rows.length > limit) console.log(`  … ${rows.length - limit} more (raise the limit arg to see them)`);
    return;
  }

  // Overview: count per category + a small sample, ordered by size.
  const byCat = new Map<Category, Row[]>();
  for (const r of rows) (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r);

  const summary = [...byCat.entries()]
    .map(([category, list]) => ({ category, count: list.length }))
    .sort((a, b) => b.count - a.count);
  console.log(`\n${rows.length} products across ${summary.length} categories:\n`);
  console.table(summary);

  console.log("Sample per category (pass a category name to dump it, or --overrides for pins):");
  for (const { category } of summary) {
    const sample = (byCat.get(category) ?? []).slice(0, limit).map((r) => r.name.slice(0, 32));
    console.log(`\n  ${category} (${byCat.get(category)?.length ?? 0}):`);
    for (const s of sample) console.log(`    ${s}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
