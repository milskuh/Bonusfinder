// src/app/api/products/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { searchSchema } from "@/lib/validation/filters";
import { searchProducts } from "@/lib/queries/products";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const params = searchSchema.parse({
      q: sp.get("q") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });
    const data = await searchProducts(params);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      // Log validation detail server-side; keep it out of the client response.
      console.warn("[GET /api/products/search] invalid query", err.issues);
      return NextResponse.json({ error: "Ongeldige zoekopdracht" }, { status: 400 });
    }
    console.error("[GET /api/products/search]", err);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
