// Unit tests for the free-text search query builders. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPrefixTsQuery, likeEscape } from "./search";

test("a single word becomes a prefix term", () => {
  assert.equal(toPrefixTsQuery("chocola"), "chocola:*");
});

test("multiple words are AND-joined prefix terms (narrows results)", () => {
  assert.equal(toPrefixTsQuery("beste chocola"), "beste:* & chocola:*");
});

test("blank / whitespace-only input returns null so the caller skips the filter", () => {
  assert.equal(toPrefixTsQuery(""), null);
  assert.equal(toPrefixTsQuery("   "), null);
});

test("punctuation-only input returns null", () => {
  assert.equal(toPrefixTsQuery("&|!()"), null);
});

test("tsquery operators in input are stripped, never injected", () => {
  const out = toPrefixTsQuery("m&m's");
  // "m", "m", "s" as prefix terms; the only `&` is our ` & ` joiner, and no
  // user-supplied operators (' | ! ( )) survive.
  assert.equal(out, "m:* & m:* & s:*");
  assert.doesNotMatch(out!, /['|!()]/);
});

test("input is lowercased (case-insensitive matching)", () => {
  assert.equal(toPrefixTsQuery("HARIBO"), "haribo:*");
});

test("accented unicode letters are preserved", () => {
  assert.equal(toPrefixTsQuery("crème"), "crème:*");
});

test("digits are kept as prefix terms", () => {
  assert.equal(toPrefixTsQuery("1+1"), "1:* & 1:*");
});

test("leading/trailing/multiple spaces collapse", () => {
  assert.equal(toPrefixTsQuery("  beste   chocola  "), "beste:* & chocola:*");
});

test("likeEscape neutralises LIKE wildcards and the escape char", () => {
  assert.equal(likeEscape("50%"), "50\\%");
  assert.equal(likeEscape("a_b"), "a\\_b");
  assert.equal(likeEscape("c:\\x"), "c:\\\\x");
  assert.equal(likeEscape("chocola"), "chocola"); // plain input untouched
});
