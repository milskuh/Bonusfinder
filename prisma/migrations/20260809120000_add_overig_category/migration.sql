-- Add OVERIG — the explicit "everything else" bucket for products that match no
-- keyword in categorize.ts and no source section fallback. Until now those landed
-- in HOUDBAAR, conflating genuine pantry goods (sauce, oil, canned, mixes) with
-- the unclassified remainder and bloating that bucket. Splitting OVERIG out lets
-- HOUDBAAR mean "pantry" again and gives the feed a clean "Overig" filter chip.
--
-- As with the earlier category splits (ALCOHOL, KOFFIE/VEGETARISCH), we rebuild the
-- type so the enum order stays canonical, with OVERIG slotted last. Every existing
-- value maps to itself (no data loss); products currently sitting in HOUDBAAR stay
-- there and are re-split into OVERIG by re-running the scrapers, not in this
-- migration.

CREATE TYPE "Category_new" AS ENUM (
  'GROENTE', 'FRUIT', 'VLEES', 'VIS', 'VEGETARISCH', 'ZUIVEL', 'EIEREN', 'KAAS',
  'BROOD_BANKET', 'DRANKEN', 'ALCOHOL', 'SODA', 'KOFFIE', 'PASTA_RIJST',
  'SNACKS_SNOEP', 'DIEPVRIES', 'HOUDBAAR', 'ONTBIJT', 'DROGISTERIJ', 'HUISHOUDEN',
  'BABY_KIND', 'HUISDIER', 'OVERIG'
);

ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "Category_new"
  USING ("category"::text::"Category_new");

DROP TYPE "Category";
ALTER TYPE "Category_new" RENAME TO "Category";
