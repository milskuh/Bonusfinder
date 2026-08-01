"use client";

import { useQuery } from "@tanstack/react-query";

// A store option for the filter chips, as serialized by GET /api/supermarkets.
export type SupermarketOption = {
  slug: string;
  name: string;
  logoUrl: string | null;
};

async function fetchSupermarkets(): Promise<SupermarketOption[]> {
  const res = await fetch("/api/supermarkets");
  if (!res.ok) {
    throw new Error(`Kon winkels niet laden (${res.status})`);
  }
  return res.json();
}

/** Stores that currently have active offers — the source for the store filter. */
export function useSupermarkets() {
  return useQuery({
    queryKey: ["supermarkets"],
    queryFn: fetchSupermarkets,
  });
}
