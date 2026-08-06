// src/app/api/basket/optimize/route.ts
// Returns the "cheapest basket" optimisation for the signed-in user's stored
// basket (multi-store split, single-store winner, savings, needs-attention).
// POST (not GET): the result depends on the live basket + current time, so it
// must never be cached.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { optimizeUserBasket } from "@/lib/queries/basket-optimize";

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  try {
    const result = await optimizeUserBasket(user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/basket/optimize]", err);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
