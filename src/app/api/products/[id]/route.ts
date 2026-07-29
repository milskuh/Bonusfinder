// src/app/api/products/[id]/route.ts
import { NextResponse } from "next/server";
import { getProductById } from "@/lib/queries/products";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const product = await getProductById(id);
    if (!product) {
      return NextResponse.json({ error: "Product niet gevonden" }, { status: 404 });
    }
    return NextResponse.json(product, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[GET /api/products/[id]]", err);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
