// src/lib/auth.ts
// Bridges Clerk's session to our local User row. Route handlers call requireUser()
// to get (or lazily create) the User for the signed-in Clerk account, or null when
// signed out — so each handler enforces auth consistently (returning 401 on null).
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

/** The signed-in user's local User row (created on first sight), or null if signed out. */
export async function requireUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return db.user.upsert({
    where: { externalId: userId },
    update: {},
    create: { externalId: userId },
  });
}
