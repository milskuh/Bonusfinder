-- Full-text search setup for Product.searchVector (Dutch text-search config).
--
-- Run this AFTER `prisma migrate` has created the "Product" table + the
-- (empty) "searchVector" tsvector column:
--
--   psql "$DIRECT_URL" -f prisma/fts_setup.sql
--
-- It is idempotent, so re-running after new migrations is safe.
--
-- Design: searchVector is kept as a plain tsvector column (matching the Prisma
-- schema, so `prisma migrate` sees no drift). A trigger recomputes it on every
-- insert/update, and a GIN index makes @@ matching fast. The final UPDATE
-- backfills any rows that already exist (e.g. after seeding).

-- 1. GIN index for fast full-text matching.
CREATE INDEX IF NOT EXISTS "Product_searchVector_idx"
  ON "Product" USING GIN ("searchVector");

-- 2. Trigger function: weight name > brand > subcategory.
CREATE OR REPLACE FUNCTION product_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('dutch', coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('dutch', coalesce(NEW."brand", '')), 'B') ||
    setweight(to_tsvector('dutch', coalesce(NEW."subcategory", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Fire the trigger only when a relevant column changes.
DROP TRIGGER IF EXISTS product_search_vector_trigger ON "Product";
CREATE TRIGGER product_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "name", "brand", "subcategory" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();

-- 4. Backfill existing rows (no-op touch that fires the trigger).
UPDATE "Product" SET "name" = "name" WHERE "searchVector" IS NULL;
