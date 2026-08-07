// src/app/api/basket/route.ts
// Per-user basket CRUD (signed-in via Clerk), following the favorites handlers.
// GET list · POST add · PUT set-quantity · DELETE remove. Pricing/optimisation is
// a separate concern — see ./optimize/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  basketAddSchema,
  basketUpdateSchema,
  basketDeleteSchema,
} from "@/lib/validation/basket";
import { db } from "@/lib/db";

const unauthorized = () => NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
// Log the Zod detail server-side; the client just gets a generic 400 so we don't
// leak internal field names / schema structure.
const badRequest = (issues: unknown) => {
  console.warn("[api/basket] invalid input", issues);
  return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
};

const productSelect = {
  select: { id: true, name: true, nameEn: true, brand: true, imageUrl: true },
} as const;

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const items = await db.basketItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { product: productSelect },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const parsed = basketAddSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  const item = await db.basketItem.upsert({
    where: { userId_productId: { userId: user.id, productId: parsed.data.productId } },
    update: {}, // idempotent add — quantity changes go through PUT
    create: {
      userId: user.id,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const parsed = basketUpdateSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  // Upsert so "set quantity to N" is idempotent even if the row was never added.
  const item = await db.basketItem.upsert({
    where: { userId_productId: { userId: user.id, productId: parsed.data.productId } },
    update: { quantity: parsed.data.quantity },
    create: {
      userId: user.id,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
    },
  });
  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const parsed = basketDeleteSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.issues);

  await db.basketItem.deleteMany({
    where: { userId: user.id, productId: parsed.data.productId },
  });
  return NextResponse.json({ ok: true });
}
