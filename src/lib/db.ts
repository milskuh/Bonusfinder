// Prisma client singleton. In dev, Next.js hot-reload re-evaluates modules on
// every change; without caching on `globalThis` that spawns a new client (and a
// new connection pool) each time, quickly exhausting Postgres connections.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
