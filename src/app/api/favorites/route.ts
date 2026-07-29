// src/app/api/favorites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { favoriteBodySchema } from "@/lib/validation/filters";
import { db } from "@/lib/db";

/** Koppelt de ingelogde Clerk-gebruiker aan (of maakt) een lokale User-rij. */
async function requireUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return db.user.upsert({
    where: { externalId: userId },
    update: {},
    create: { externalId: userId },
  });
}

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
            where: { validUntil: { gte: new Date() } },
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
