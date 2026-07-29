-- Split `VLEES_VIS` into `VLEES` + `VIS`, and add `SODA` alongside `DRANKEN`.
--
-- Postgres cannot drop a value from an existing enum, so we build the new enum,
-- convert the column with a value mapping, and drop the old type. Existing
-- `VLEES_VIS` rows are mapped to `VLEES` (fish could not be distinguished
-- automatically; re-run the scrapers to re-categorise fish products as `VIS`).

-- 1. New enum type with the finer-grained values.
CREATE TYPE "Category_new" AS ENUM (
  'GROENTE_FRUIT', 'VLEES', 'VIS', 'ZUIVEL', 'KAAS', 'BROOD_BANKET',
  'DRANKEN', 'SODA', 'SNACKS_SNOEP', 'DIEPVRIES', 'HOUDBAAR', 'ONTBIJT',
  'DROGISTERIJ', 'HUISHOUDEN', 'BABY_KIND', 'HUISDIER'
);

-- 2. Convert "Product"."category" to the new type, mapping the retired value.
ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "Category_new"
  USING (
    CASE "category"::text
      WHEN 'VLEES_VIS' THEN 'VLEES'
      ELSE "category"::text
    END::"Category_new"
  );

-- 3. Swap the types.
DROP TYPE "Category";
ALTER TYPE "Category_new" RENAME TO "Category";
