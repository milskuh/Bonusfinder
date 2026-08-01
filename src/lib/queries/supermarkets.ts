// src/lib/queries/supermarkets.ts
import { db } from "@/lib/db";

// Drives the store-filter chips in the offers feed. We only surface stores that
// currently have at least one active offer (validUntil in the future) — the same
// "active" window getOffers uses — so the filter never shows an empty store.
export async function getActiveSupermarkets() {
  const now = new Date();
  return db.supermarket.findMany({
    where: { offers: { some: { validUntil: { gte: now } } } },
    select: { slug: true, name: true, logoUrl: true },
    orderBy: { name: "asc" },
  });
}

export type ActiveSupermarket = Awaited<
  ReturnType<typeof getActiveSupermarkets>
>[number];
