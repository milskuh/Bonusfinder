// src/scrapers/match.ts
// Shared text normaliser + boundary-aware keyword matcher used by the category
// classifier (categorize.ts). Kept separate and database-free so the matching
// primitives are unit-tested in isolation and reused by any future rule pass.
//
// Why this exists: the old classifier matched keywords with a bare "does this
// keyword start a word?" test. That over-reaches on short, collision-prone stems
// — "koek" matched "koekenpan" (a frying pan), "ijs" matched "ijscrusher", "vis"
// matched "Vision", "ham" matched "Hamka's", "water" matched "waterborstel". The
// three pattern kinds below make each rule say exactly what it means: a whole
// token, a compound-friendly prefix (optionally minus known exceptions), or a
// multi-word phrase.

/** Lower-case, strip diacritics and apostrophes: "STËLZ" → "stelz", "Hamka's" → "hamkas". */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop combining accents (crème → creme)
    .replace(/['’`]/g, ""); // Hamka's → hamkas
}

/** Split a normalised name into alphanumeric tokens. */
export function tokenize(s: string): string[] {
  return normalizeName(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export type Pattern =
  | { kind: "word"; text: string } // matches a whole token only
  | { kind: "prefix"; text: string; except?: readonly string[] } // compound-friendly, minus exceptions
  | { kind: "phrase"; text: string }; // multi-word / hyphenated substring on the normalised name

/** True when pattern `p` matches, given a name's `tokens` and its normalised form `nameNorm`. */
export function patternMatches(p: Pattern, tokens: readonly string[], nameNorm: string): boolean {
  switch (p.kind) {
    case "word":
      return tokens.includes(p.text);
    case "prefix":
      return tokens.some((t) => t.startsWith(p.text) && !(p.except ?? []).includes(t));
    case "phrase":
      return nameNorm.includes(p.text);
  }
}

// --- Terse constructors so rule tables stay readable ------------------------

/** Whole-token match (`word("ui")` matches "rode ui" but not "uitsmijter"). */
export const word = (text: string): Pattern => ({ kind: "word", text });
/** Compound-friendly prefix (`prefix("kip")` matches "kipfilet"), minus `except` tokens. */
export const prefix = (text: string, except?: readonly string[]): Pattern => ({
  kind: "prefix",
  text,
  except,
});
/** Multi-word / hyphenated substring on the whole normalised name. */
export const phrase = (text: string): Pattern => ({ kind: "phrase", text });
