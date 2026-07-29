-- Split GROENTE_FRUIT into GROENTE + FRUIT, and add EIEREN (split from ZUIVEL)
-- and PASTA_RIJST (split from HOUDBAAR) so the GUI can filter them separately.
--
-- Postgres can't drop an enum value in place, so we rebuild the type. Existing
-- GROENTE_FRUIT rows map to GROENTE (fruit can't be told apart automatically);
-- re-running the scrapers re-categorises everything with the finer buckets.

CREATE TYPE "Category_new" AS ENUM (
  'GROENTE', 'FRUIT', 'VLEES', 'VIS', 'ZUIVEL', 'EIEREN', 'KAAS', 'BROOD_BANKET',
  'DRANKEN', 'SODA', 'PASTA_RIJST', 'SNACKS_SNOEP', 'DIEPVRIES', 'HOUDBAAR',
  'ONTBIJT', 'DROGISTERIJ', 'HUISHOUDEN', 'BABY_KIND', 'HUISDIER'
);

ALTER TABLE "Product"
  ALTER COLUMN "category" TYPE "Category_new"
  USING (
    CASE "category"::text
      WHEN 'GROENTE_FRUIT' THEN 'GROENTE'
      ELSE "category"::text
    END::"Category_new"
  );

DROP TYPE "Category";
ALTER TYPE "Category_new" RENAME TO "Category";
