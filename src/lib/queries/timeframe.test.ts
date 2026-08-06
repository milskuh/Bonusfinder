// Unit tests for the feed's timeframe date predicate. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeframeWhere } from "./timeframe";

const now = new Date("2026-08-03T12:00:00Z");

test("current timeframe requires the window to have started and not yet ended", () => {
  // Both bounds: excludes not-yet-started offers (validFrom > now) AND expired
  // ones (validUntil < now).
  assert.deepEqual(timeframeWhere("current", now), {
    validFrom: { lte: now },
    validUntil: { gte: now },
  });
});

test("upcoming timeframe selects only offers that have not started yet", () => {
  // No validUntil bound needed — a future validFrom already implies a future end.
  assert.deepEqual(timeframeWhere("upcoming", now), {
    validFrom: { gt: now },
  });
});

test("the two timeframes are disjoint (an offer is never in both tabs)", () => {
  const current = timeframeWhere("current", now) as {
    validFrom: { lte: Date };
  };
  const upcoming = timeframeWhere("upcoming", now) as {
    validFrom: { gt: Date };
  };
  // current caps validFrom at <= now; upcoming floors it at > now — no overlap.
  assert.equal(current.validFrom.lte.getTime(), now.getTime());
  assert.equal(upcoming.validFrom.gt.getTime(), now.getTime());
});
