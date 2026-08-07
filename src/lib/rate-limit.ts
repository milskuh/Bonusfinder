// src/lib/rate-limit.ts
// Rate limiting for the public API and per-user mutations (finding F5).
//
// Two backends, chosen at module load:
//   * Upstash Redis (preferred) — used when UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN are set. A sliding-window limit shared across every
//     Vercel isolate, so a single client is limited globally (the stress test
//     showed the in-memory limiter never fired because each edge isolate counted
//     independently — ceiling ≈ limit × isolates).
//   * In-memory fixed window (fallback) — zero-dependency, used when Upstash isn't
//     configured, and as a safety net if Upstash is unreachable. Per-instance, so
//     best-effort only; kept so the app is never *un*limited or broken by config.
//
// Both paths are fail-open: if the limiter throws, callers let the request through
// (see middleware.ts). Call `checkRateLimit()` from callers; the raw `rateLimit()`
// in-memory primitive stays exported for the fallback and for tests.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Per-minute allowances. Reads can legitimately burst (infinite-feed pagination);
// mutations are per-user and cheaper to abuse.
export const LIMITS = { read: 200, mutation: 60 } as const;
export type RateLimitKind = keyof typeof LIMITS;
const WINDOW_MS = 60_000;

// Build the Upstash limiters once, only when both env vars are present. Sliding
// window is more accurate than the in-memory fixed window; the prefix namespaces
// the buckets so they can't collide with anything else on the same Redis.
const upstashLimiters: Record<RateLimitKind, Ratelimit> | null = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  const make = (limit: number, prefix: string) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, "60 s"),
      prefix,
      analytics: false,
    });
  return {
    read: make(LIMITS.read, "rl:read"),
    mutation: make(LIMITS.mutation, "rl:mut"),
  };
})();

/** Which backend is active — handy for a health check / logging. */
export const rateLimitBackend: "upstash" | "memory" = upstashLimiters ? "upstash" : "memory";

/**
 * Record one hit against `key` for the given request `kind` and report whether
 * it's within the allowance. Uses Upstash when configured, falling back to the
 * in-memory limiter (also on Upstash errors) so the app is never left unlimited.
 */
export async function checkRateLimit(key: string, kind: RateLimitKind): Promise<RateLimitResult> {
  if (upstashLimiters) {
    try {
      const r = await upstashLimiters[kind].limit(key);
      // Upstash `reset` is already an epoch-ms timestamp, matching resetAt.
      return { ok: r.success, limit: r.limit, remaining: r.remaining, resetAt: r.reset };
    } catch {
      // Upstash unreachable → degrade to the in-memory limiter rather than to no
      // limit at all. Namespaced so the fallback buckets are per-kind too.
    }
  }
  return rateLimit(`${kind}:${key}`, LIMITS[kind], WINDOW_MS);
}

type Bucket = { count: number; resetAt: number };

// Module-level store: persists across requests handled by the same runtime
// instance (Node lambda or Edge isolate).
const store = new Map<string, Bucket>();

// Opportunistic sweep so the map can't grow without bound under many distinct
// keys (e.g. lots of IPs). Runs at most once a minute, on access.
let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitResult {
  /** false once the caller has exceeded `limit` within the current window. */
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

/**
 * Record one hit against `key` and report whether it's within `limit` per
 * `windowMs`. Pure and synchronous; never throws for normal inputs.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { ok: true, limit, remaining: limit - 1, resetAt };
  }

  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
