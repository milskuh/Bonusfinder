-- Add two categories:
--   * VEGETARISCH — meat/fish substitutes & explicitly vegetarian/vegan products,
--     which today get mis-filed into VLEES/VIS/GROENTE because their names copy
--     the animal words ("vegetarische kipstukjes", plant "tonijn").
--   * KOFFIE — coffee beans/pads/cups/capsules, instant & RTD coffee, split out of
--     the generic DRANKEN/ONTBIJT buckets.
--
-- Postgres can't insert an enum value at a chosen position in place, so — as with
-- the earlier ALCOHOL split and the category splits before it — we rebuild the
-- type with VEGETARISCH slotted after VIS and KOFFIE after SODA. Every existing
-- value maps to itself (no data loss); products are only re-bucketed into the new
-- categories afterwards by re-running the scrapers + a name-based reclassify, not
-- in this migration.

CREATE TYPE "Category_new" AS ENUM (
  'GROENTE', 'FRUIT', 'VLEES', 'VIS', 'VEGETARISCH', 'ZUIVEL', 'EIEREN', 'KAAS',
  'BROOD_BANKET', 'DRANKEN', 'ALCOHOL', 'SODA', 'KOFFIE', 'PASTA_RIJST',
  'SNACKS_SNOEP', 'DIEPVRIES', 'HOUDBAAR', 'ONTBIJT', 'DROGISTERIJ', 'HUISHOUDEN',
  'BABY_KIND', 'HUISDIER'
);

ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "Category_new"
  USING ("category"::text::"Category_new");

DROP TYPE "Category";
ALTER TYPE "Category_new" RENAME TO "Category";
