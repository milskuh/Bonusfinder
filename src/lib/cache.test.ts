// Tests for the in-process single-flight TTL cache (lib/cache.ts). These lock in
// the two properties the /api/offers throughput fix relies on: concurrent callers
// for one key share a single in-flight run, and rejections are never cached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cached } from "./cache";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const uniqueKey = () => `k${seq++}`;

test("coalesces concurrent identical calls into one run (single-flight)", async () => {
  const key = uniqueKey();
  let calls = 0;
  const fn = async () => {
    calls++;
    await delay(10);
    return calls;
  };
  const [a, b, c] = await Promise.all([
    cached(key, 1000, fn),
    cached(key, 1000, fn),
    cached(key, 1000, fn),
  ]);
  assert.equal(calls, 1, "fn should run once for concurrent identical keys");
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test("serves a cached value within the TTL, refetches after it expires", async () => {
  const key = uniqueKey();
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls;
  };
  assert.equal(await cached(key, 20, fn), 1);
  assert.equal(await cached(key, 20, fn), 1, "still cached before TTL");
  await delay(30);
  assert.equal(await cached(key, 20, fn), 2, "refetched after TTL");
});

test("does not cache a rejection — the next call retries", async () => {
  const key = uniqueKey();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return calls;
  };
  await assert.rejects(() => cached(key, 1000, fn), /boom/);
  assert.equal(await cached(key, 1000, fn), 2, "retries after a failed call");
});

test("distinct keys are cached independently", async () => {
  const k1 = uniqueKey();
  const k2 = uniqueKey();
  assert.equal(await cached(k1, 1000, async () => "a"), "a");
  assert.equal(await cached(k2, 1000, async () => "b"), "b");
  assert.equal(await cached(k1, 1000, async () => "changed"), "a", "k1 still cached");
});
