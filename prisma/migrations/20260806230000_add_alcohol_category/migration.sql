-- Add ALCOHOL, splitting alcoholic drinks (beer / wine / spirits) out of the
-- broad DRANKEN bucket so they get their own filter and are comparable across
-- stores (all of Gall & Gall is alcohol; supermarkets carry beer/wine too).
--
-- Postgres can't insert an enum value at a chosen position in place, so — as with
-- the earlier category splits — we rebuild the type with ALCOHOL slotted after
-- DRANKEN. Every existing value maps to itself (no data loss); alcoholic products
-- are moved into ALCOHOL afterwards by re-running the scrapers + a name-based
-- reclassify, not in this migration.

CREATE TYPE "Category_new" AS ENUM (
  'GROENTE', 'FRUIT', 'VLEES', 'VIS', 'ZUIVEL', 'EIEREN', 'KAAS', 'BROOD_BANKET',
  'DRANKEN', 'ALCOHOL', 'SODA', 'PASTA_RIJST', 'SNACKS_SNOEP', 'DIEPVRIES',
  'HOUDBAAR', 'ONTBIJT', 'DROGISTERIJ', 'HUISHOUDEN', 'BABY_KIND', 'HUISDIER'
);

ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "Category_new"
  USING ("category"::text::"Category_new");

DROP TYPE "Category";
ALTER TYPE "Category_new" RENAME TO "Category";
