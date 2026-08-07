// src/lib/cache.ts
// Tiny in-process, single-flight TTL cache (stress-test finding: the /api/offers
// DB path sustains only ~5 rps because each request holds the one pooled
// connection — connection_limit=1 — for count + findMany + groupBy, so concurrent
// requests queue).
//
// Same spirit as rate-limit.ts: zero dependencies, state in module memory, and
// safe by construction. Two properties do the work:
//
//   1. Single-flight (request coalescing): concurrent callers for the same key
//      share ONE in-flight promise, so N simultaneous identical feed loads cost a
//      single DB round-trip instead of N. This is exactly the concurrency the load
//      test hammered.
//   2. Short TTL: a resolved value is reused for `ttlMs`, keeping hot filter
//      combos off the DB entirely — including for signed-in requests whose Clerk
//      cookies make Vercel bypass the shared edge cache.
//
// Caveat (on purpose): the store is per serverless instance, so it's a best-effort
// read reducer layered under the CDN's s-maxage, not a global cache. Rejections are
// never cached. Bounded size + an opportunistic sweep keep the map from growing
// without limit under many distinct keys.

type Entry = { value: Promise<unknown>; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 500;

let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/**
 * Return `fn()`'s result for `key`, reusing a cached (or still in-flight) result
 * while it's within `ttlMs`. Never caches a rejected promise.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  sweep(now);

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const promise = fn();
  // Don't let a failed call poison the cache: drop it so the next request retries.
  promise.catch(() => {
    const current = store.get(key);
    if (current && current.value === promise) store.delete(key);
  });

  // Bound growth: Map preserves insertion order, so the first key is the oldest.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value: promise, expiresAt: now + ttlMs });
  return promise;
}
