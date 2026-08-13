// Runs categorize() over the permanent fixture table (categorize.fixtures.ts) and
// asserts every row lands in its expected Category. This is the regression guard:
// a new misclassification is fixed by adding a row here first, then making it green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Category } from "@prisma/client";
import { categorize } from "./categorize";
import { CATEGORY_FIXTURES } from "./categorize.fixtures";

test("every category fixture resolves to its expected Category", () => {
  const failures: string[] = [];
  for (const f of CATEGORY_FIXTURES) {
    const hints = [f.brand].filter(Boolean) as string[];
    const got = categorize(f.name, hints, { source: f.source, section: f.section });
    if (got !== f.expected) {
      failures.push(
        `  "${f.name}"${f.source ? ` [${f.source}]` : ""} → ${got}, expected ${f.expected}` +
          (f.note ? `  (${f.note})` : ""),
      );
    }
  }
  assert.equal(
    failures.length,
    0,
    `\n${failures.length} fixture(s) misclassified:\n${failures.join("\n")}\n`,
  );
});

// Guard the enum values used in the fixtures are real (a typo'd expected would
// otherwise silently never match).
test("fixture expected values are valid Category enum members", () => {
  for (const f of CATEGORY_FIXTURES) {
    assert.ok(f.expected in Category, `unknown Category "${f.expected}" in fixture "${f.name}"`);
  }
});
