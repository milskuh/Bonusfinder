// src/app/api/favorites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { favoriteBodySchema } from "@/lib/validation/filters";
import { timeframeWhere } from "@/lib/queries/timeframe";
import { db } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const favorites = await db.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: {
          offers: {
            // "current" timeframe (validFrom <= now AND validUntil >= now) so a
            // favourite's cheapest deal is one you can actually buy now, not a
            // next-week offer already ingested into the DB.
            where: timeframeWhere("current", new Date()),
            orderBy: { pricePerUnit: "asc" },
            take: 1,
            include: { supermarket: { select: { slug: true, name: true, logoUrl: true } } },
          },
        },
      },
    },
  });
  return NextResponse.json({ items: favorites });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const parsed = favoriteBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ongeldige invoer", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const favorite = await db.favorite.upsert({
    where: { userId_productId: { userId: user.id, productId: parsed.data.productId } },
    update: {},
    create: { userId: user.id, productId: parsed.data.productId },
  });
  return NextResponse.json({ favorite }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const parsed = favoriteBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ongeldige invoer", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await db.favorite.deleteMany({
    where: { userId: user.id, productId: parsed.data.productId },
  });
  return NextResponse.json({ ok: true });
}
