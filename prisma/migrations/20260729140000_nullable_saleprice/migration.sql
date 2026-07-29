-- Make Offer.salePrice nullable: some promotions (e.g. Albert Heijn
-- "25% korting" / "1+1 gratis") have no single sale price and carry only
-- offerText / discountPercent.
ALTER TABLE "Offer" ALTER COLUMN "salePrice" DROP NOT NULL;
