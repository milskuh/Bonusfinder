// src/scrapers/types.ts
// Shared contract between the individual supermarket scrapers and the
// persistence layer. A scraper's only job is to turn a supermarket's public
// offer listing into a list of `ScrapedOffer`s; `persist.ts` handles all
// database writes so every source stays thin and uniform.
import type { Category, CategorySource } from "@prisma/client";

/** One offer as scraped from a supermarket, before it touches the database. */
export interface ScrapedOffer {
  /** Product name as shown to shoppers, e.g. "Johma XL salade". */
  name: string;
  /** Brand if separable from the name, else null. */
  brand: string | null;
  category: Category;
  /**
   * How `category` was decided, for provenance. Omit for the ordinary keyword
   * path — persist.ts records it as `rule`. A source-section-driven scraper may set
   * `source`; `manual`/`llm` are applied by persist.ts / the backstop, not scrapers.
   */
  categorySource?: CategorySource;
  /** Supermarket's own sub-department label, e.g. "Vlees, kip, vis". */
  subcategory: string | null;
  imageUrl: string | null;

  /**
   * Current (discounted) price in euros; the lowest for a range. Null for
   * promotions that have no single price (e.g. AH "25% korting", "1+1 gratis").
   */
  salePrice: number | null;
  /** Pre-discount (normal) price in euros, or null if the source shows none. */
  originalPrice: number | null;
  /**
   * 1–100 when there is a real originalPrice > salePrice, otherwise null.
   * Deals like "1+1 gratis" keep this null and rely on `offerText` instead.
   */
  discountPercent: number | null;
  /** Raw promo label, e.g. "1+1 gratis", "per kuip 2.99". Shown as-is in the UI. */
  offerText: string | null;

  /** Pack size normalised to a base unit, e.g. 0.3 with unit "kg". */
  contentAmount: number | null;
  /** Base unit for `contentAmount` / `pricePerUnit`: "kg" | "l" | "stuk". */
  contentUnit: string | null;

  /** Deep link to the product/offer page at the source. */
  deepLink: string | null;

  /** Offer validity window. `validUntil` is required to expire stale offers. */
  validFrom: Date;
  validUntil: Date;
}

/** A single supermarket source. */
export interface Scraper {
  /** Supermarket slug used as the natural key, e.g. "hoogvliet". */
  slug: string;
  /** Display name, e.g. "Hoogvliet". */
  name: string;
  logoUrl?: string;
  /** Fetch + parse the current offers. Should throw on hard failures. */
  scrape(): Promise<ScrapedOffer[]>;
}
