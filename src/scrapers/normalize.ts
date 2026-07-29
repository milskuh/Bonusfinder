// src/scrapers/normalize.ts
// Ingestion pipeline step: turns raw, source-specific price fields into the
// normalized shape the rest of the app relies on. Kept separate from the
// per-source adapters so the discount rules live in exactly one place.

export interface RawPrice {
  /** Lowest sale/offer price in euros (required). */
  salePrice: number;
  /** Normal/"koopprijs" in euros, if the source shows one. */
  originalPrice: number | null;
  /** Raw promo label, e.g. "1+1 gratis", "per kuip 2.99". */
  offerText: string | null;
}

export interface NormalizedPrice {
  salePrice: number;
  originalPrice: number | null;
  discountPercent: number | null;
  offerText: string | null;
}

/**
 * True for multi-buy / bundle deals ("1+1 gratis", "2e halve prijs",
 * "3 voor 5.00", …). For these the price shown isn't a straight per-unit
 * discount, so we must not derive a percentage from it.
 */
export function isMultiBuyOffer(offerText: string | null): boolean {
  if (!offerText) return false;
  return (
    /\d+\s*\+\s*\d+/.test(offerText) || // 1+1, 2+1
    /\bgratis\b/i.test(offerText) || // ... gratis
    /\d+\s*(?:e|de)\s+(?:halve|gratis|artikel)/i.test(offerText) || // 2e halve prijs, 2e gratis
    /halve\s+prijs/i.test(offerText) || // (2e) halve prijs
    /\d+\s+voor\s+[\d.,]+/i.test(offerText) // 3 voor 5.00
  );
}

/**
 * discountPercent = round((originalPrice - salePrice) / originalPrice * 100)
 * when originalPrice > salePrice, otherwise null.
 *
 * For deals without a separate normal price (e.g. "1+1 gratis",
 * "2e halve prijs", "3 voor 5.00") we keep only salePrice + offerText and leave
 * originalPrice/discountPercent empty — even when the source happens to show a
 * strikethrough — because a synthetic percentage would be misleading (the
 * shopper must buy multiple to get it).
 */
export function normalizePrice(raw: RawPrice): NormalizedPrice {
  const { salePrice, offerText } = raw;
  const originalPrice = raw.originalPrice;

  if (!isMultiBuyOffer(offerText) && originalPrice != null && originalPrice > salePrice) {
    const discountPercent = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
    return { salePrice, originalPrice, discountPercent, offerText };
  }

  return { salePrice, originalPrice: null, discountPercent: null, offerText };
}
