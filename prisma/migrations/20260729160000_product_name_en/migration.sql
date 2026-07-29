-- English translation of Product.name, populated out-of-band by
-- `npm run db:translate` (Claude). Null until translated; the UI falls back to
-- the Dutch name when English is selected but no translation exists yet.
ALTER TABLE "Product" ADD COLUMN "nameEn" TEXT;
