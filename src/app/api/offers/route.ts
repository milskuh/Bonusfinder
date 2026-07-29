// src/app/api/offers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseOfferFilters } from "@/lib/validation/filters";
import { getOffers } from "@/lib/queries/offers";

export async function GET(req: NextRequest) {
  try {
    const filters = parseOfferFilters(req.nextUrl.searchParams);
    const data = await getOffers(filters);

    // Aanbiedingen wijzigen alleen bij een ingestie-run → edge-cache mag lang.
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Ongeldige filters", issues: err.issues },
        { status: 400 },
      );
    }
    console.error("[GET /api/offers]", err);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
