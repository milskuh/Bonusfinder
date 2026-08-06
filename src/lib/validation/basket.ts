// src/lib/validation/basket.ts
// Zod schemas for the basket API payloads — one source of truth shared by the
// route handlers and the React Query hooks (the same end-to-end type-safe pattern
// as filters.ts). Quantity is a small positive integer.
import { z } from "zod";

const QUANTITY_MAX = 99;

/** Add a product to the basket. Quantity defaults to 1 (idempotent add). */
export const basketAddSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1).max(QUANTITY_MAX).default(1),
});
export type BasketAddBody = z.infer<typeof basketAddSchema>;

/** Set the quantity of a basket line. */
export const basketUpdateSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1).max(QUANTITY_MAX),
});
export type BasketUpdateBody = z.infer<typeof basketUpdateSchema>;

/** Remove a product from the basket. */
export const basketDeleteSchema = z.object({ productId: z.string().cuid() });
export type BasketDeleteBody = z.infer<typeof basketDeleteSchema>;
