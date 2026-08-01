// src/app/api/supermarkets/route.ts
import { NextResponse } from "next/server";
import { getActiveSupermarkets } from "@/lib/queries/supermarkets";

export async function GET() {
  try {
    const data = await getActiveSupermarkets();

    // De actieve-winkelset wijzigt alleen bij een ingestie-run → edge-cache mag lang.
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[GET /api/supermarkets]", err);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
