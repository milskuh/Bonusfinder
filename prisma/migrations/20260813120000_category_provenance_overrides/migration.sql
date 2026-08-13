-- §7 of the categorisation rework: category provenance + durable manual overrides.
-- See CATEGORIZATION_FIX.md.
--
-- Additive only — no data loss, no column drops. Existing Product rows get
-- categorySource = 'rule' automatically via the column DEFAULT (the keyword rules
-- are what classified everything up to now).
--
-- IMPORTANT: apply this (`prisma migrate deploy`) BEFORE the next `npm run db:scrape`.
-- persist.ts now writes `categorySource`, so the column must already exist or the
-- scrape transaction will fail. No `npm run db:fts` needed (no searchable column
-- changed).

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('source', 'rule', 'llm', 'manual');

-- AlterTable
ALTER TABLE "Product"
  ADD COLUMN "categorySource" "CategorySource" NOT NULL DEFAULT 'rule',
  ADD COLUMN "categoryConfidence" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CategoryOverride" (
    "productMatchKey" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryOverride_pkey" PRIMARY KEY ("productMatchKey")
);
