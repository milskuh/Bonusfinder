// src/lib/rate-limit.ts
// A tiny, zero-dependency, in-memory fixed-window rate limiter (finding F5).
//
// Design goals, in priority order:
//   1. Never break the app. There is no external service to be down or
//      misconfigured, and every caller path is fail-open — if anything here
//      throws, the request is allowed through (see middleware.ts).
//   2. Blunt burst-abuse protection for the public API and the per-user
//      mutations, with limits generous enough that real usage never trips them.
//
// Caveat (documented on purpose): state lives in module memory, so on a
// multi-instance serverless deploy (Vercel) each instance counts independently —
// the effective ceiling is `limit × instances`. That's an accepted trade-off for
// having zero moving parts. To make the limit global, back this with Upstash/
// Redis later; the call sites won't need to change.

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
