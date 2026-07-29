-- Add deep link on Product, and offerText + nullable discountPercent on Offer.
--
-- discountPercent becomes nullable so offers without a separate "normal" price
-- (e.g. "1+1 gratis") can leave it empty instead of a misleading 0. Existing
-- rows with 0 are left as-is; the scraper repopulates them on the next run.

ALTER TABLE "Product" ADD COLUMN "url" TEXT;

ALTER TABLE "Offer" ADD COLUMN "offerText" TEXT;
ALTER TABLE "Offer" ALTER COLUMN "discountPercent" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "discountPercent" DROP NOT NULL;
