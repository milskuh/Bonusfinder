// src/lib/validation/filters.ts
// Eén bron van waarheid voor query-parameters. De afgeleide types (OfferFilters,
// SearchParams, ...) worden zowel server-side (route handlers/queries) als
// client-side (React Query hooks) geïmporteerd → end-to-end type-safe.
import { z } from "zod";
import { Category } from "@prisma/client";

export const offerSortSchema = z
  .enum(["newest", "discount", "price", "unitPrice"])
  .default("newest");
export type OfferSort = z.infer<typeof offerSortSchema>;

// Which validity window the feed shows: the currently-running week (default) or
// next week's ad, once a source has published it. See timeframeWhere in
// lib/queries/timeframe.ts for the exact date predicate each maps to.
export const timeframeSchema = z.enum(["current", "upcoming"]).default("current");
export type Timeframe = z.infer<typeof timeframeSchema>;

export const offerFiltersSchema = z.object({
  // Vrije-tekst zoekopdracht over productnamen (Postgres full-text search).
  // Leeg/afwezig => geen filtering (zie getOffers). Getrimd + gemaximeerd.
  q: z.string().trim().max(100).optional(),
  supermarkets: z.array(z.string()).optional(), // slugs: ["ah", "jumbo"]
  categories: z.array(z.nativeEnum(Category)).optional(),
  subcategories: z.array(z.string()).optional(),
  brands: z.array(z.string()).optional(),
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  discountMin: z.coerce.number().min(0).max(100).optional(),
  expiringToday: z.boolean().optional(),
  timeframe: timeframeSchema,
  sort: offerSortSchema,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type OfferFilters = z.infer<typeof offerFiltersSchema>;

/** Parse filters uit URLSearchParams (multi-waarden komma-gescheiden). */
export function parseOfferFilters(sp: URLSearchParams): OfferFilters {
  const list = (key: string) => {
    const v = sp.get(key);
    return v ? v.split(",").filter(Boolean) : undefined;
  };
  return offerFiltersSchema.parse({
    q: sp.get("q") ?? undefined,
    supermarkets: list("supermarkets"),
    categories: list("categories"),
    subcategories: list("subcategories"),
    brands: list("brands"),
    priceMin: sp.get("priceMin") ?? undefined,
    priceMax: sp.get("priceMax") ?? undefined,
    discountMin: sp.get("discountMin") ?? undefined,
    expiringToday: sp.get("expiringToday") === "true" || undefined,
    timeframe: sp.get("timeframe") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
}

export const searchSchema = z.object({
  q: z.string().min(2).max(100),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type SearchParams = z.infer<typeof searchSchema>;

export const favoriteBodySchema = z.object({ productId: z.string().cuid() });
export type FavoriteBody = z.infer<typeof favoriteBodySchema>;
