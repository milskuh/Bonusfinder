// src/scrapers/product-match.ts
// Pure product-matching key used by persist.ts to decide whether a freshly
// scraped offer belongs to a Product we already have — across runs AND across
// supermarkets. Kept database-free so the matching rule is unit-tested without a
// database (see product-match.test.ts), the same split as offer-plan.ts.
//
// Why this exists: the old key was `"<name> <brand>"` after a bare
// trim+lowercase, i.e. an *exact* string match. The same article carries subtly
// different labels at each store ("Coca-Cola 1,5 L" vs "Coca Cola 1.5l" vs
// "cola 1500 ml"), so barely any product was recognised as the same across
// stores (~1.4% overlap) and the "cheapest across stores" optimiser had almost
// nothing to compare. This normaliser folds those differences away so genuinely
// identical articles collapse to one key.
//
// Design priority: **no false matches** (a wrong merge would show a wrong price).
// So identity is (normalised name+brand token set) + (canonical pack size):
//   * Diacritics, punctuation and casing are stripped.
//   * The pack size ("500 g", "1,5 l", "6 x 33 cl") is parsed out of the name and
//     canonicalised to a base unit, then made *part of* the key — so different
//     sizes of the same article stay distinct (500 g pack != 1 kg pack) even
//     though their words are identical.
//   * The remaining words are lower-cased, de-duplicated and sorted, so word
//     order and a brand repeated inside the name ("Coca-Cola Coca-Cola 1,5L")
//     don't matter.
// The trade-off is recall, not precision: when a store omits the size entirely we
// can only match it to another size-less label, never to a sized one. That yields
// a *missed* match (two rows for one article), never a *false* one.

/** The product fields the match key is derived from. */
export interface ProductIdentity {
  name: string;
  brand: string | null;
  /** Pack size normalised to a base unit by the scraper, if it provided one. */
  contentAmount?: number | null;
  /** Base unit for contentAmount ("kg" | "l" | "stuk" | "g" | "ml" | ...). */
  contentUnit?: string | null;
}

/** A pack size reduced to one of three base units. */
interface Size {
  amount: number;
  unit: "kg" | "l" | "stuk";
}

// Words that carry no identifying signal on their own; dropped before comparing
// so "melk met honing" and "melk honing" match. Kept deliberately tiny — every
// extra word here is a small step towards a false match.
const STOPWORDS = new Set(["de", "het", "een", "en", "met", "per", "van", "voor"]);

// Unit spellings → their base unit and the factor to reach it. Grams/millilitres
// collapse into kg/l so "500 g" and "0,5 kg" are the same size.
const UNIT_TO_BASE: Record<string, { unit: Size["unit"]; factor: number }> = {
  kg: { unit: "kg", factor: 1 },
  kilo: { unit: "kg", factor: 1 },
  kilogram: { unit: "kg", factor: 1 },
  g: { unit: "kg", factor: 0.001 },
  gr: { unit: "kg", factor: 0.001 },
  gram: { unit: "kg", factor: 0.001 },
  l: { unit: "l", factor: 1 },
  ltr: { unit: "l", factor: 1 },
  liter: { unit: "l", factor: 1 },
  dl: { unit: "l", factor: 0.1 },
  cl: { unit: "l", factor: 0.01 },
  ml: { unit: "l", factor: 0.001 },
  milliliter: { unit: "l", factor: 0.001 },
  centiliter: { unit: "l", factor: 0.01 },
  stuk: { unit: "stuk", factor: 1 },
  stuks: { unit: "stuk", factor: 1 },
  stk: { unit: "stuk", factor: 1 },
  st: { unit: "stuk", factor: 1 },
};

// Alternation of unit spellings, longest first so "stuks" wins over "stuk" and
// "kilogram" over "kg". Shared by the multiplier and single-size regexes.
const UNITS = Object.keys(UNIT_TO_BASE)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = "\\d+(?:[.,]\\d+)?";
// "6 x 33 cl" / "2x1l": a count times a per-item amount+unit.
const MULTIPLIER_RE = new RegExp(`(\\d+)\\s*[x×]\\s*(${NUM})\\s*(${UNITS})\\b`, "i");
// A single "500 g" / "1,5 l" / "10 stuks".
const SINGLE_RE = new RegExp(`(${NUM})\\s*(${UNITS})\\b`, "gi");

/** Lower-cased, accent-free copy of a string (é→e, ü→u). */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const parseNum = (s: string): number => Number(s.replace(",", "."));

/** Reduce an amount+unit to a base unit, or null if the unit is unrecognised. */
function toBaseUnit(amount: number, unit: string): Size | null {
  const base = UNIT_TO_BASE[unit.trim().toLowerCase()];
  if (!base || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount: amount * base.factor, unit: base.unit };
}

/**
 * Pull the pack size out of a product label and return both the size and the
 * label with the size text removed (so it can't leak into the word tokens).
 * Handles a multiplier form ("6 x 33 cl" → 1.98 l) and one-or-more plain sizes,
 * taking the first plain size as the representative one.
 */
export function parseSizeFromText(text: string): { size: Size | null; cleaned: string } {
  let cleaned = stripDiacritics(text.toLowerCase());
  let size: Size | null = null;

  const mult = MULTIPLIER_RE.exec(cleaned);
  if (mult) {
    const count = parseNum(mult[1]);
    const per = toBaseUnit(parseNum(mult[2]), mult[3]);
    if (per && Number.isFinite(count) && count > 0) size = { amount: per.amount * count, unit: per.unit };
    cleaned = cleaned.replace(mult[0], " ");
  }

  // Strip every remaining plain size; adopt the first as the size if the
  // multiplier form didn't already set one.
  cleaned = cleaned.replace(SINGLE_RE, (match, num: string, unit: string) => {
    if (!size) {
      const s = toBaseUnit(parseNum(num), unit);
      if (s) size = s;
    }
    return " ";
  });

  return { size, cleaned };
}

/** Canonical string for a size, e.g. {1.5, "l"} → "1.5l". Trailing zeros dropped. */
function formatSize(size: Size): string {
  // toFixed(3)+parseFloat gives a stable, precision-limited number: 1.500 → 1.5,
  // 0.33 → 0.33, so structured 1.5 and parsed 1.5 render identically.
  return `${parseFloat(size.amount.toFixed(3))}${size.unit}`;
}

/**
 * The cross-run, cross-store identity key for a product. Two labels that denote
 * the same article at the same pack size produce the same key; different sizes,
 * or genuinely different articles, produce different keys.
 */
export function productMatchKey(p: ProductIdentity): string {
  // Prefer the scraper's structured size; fall back to a size parsed from the
  // name. Either way, remove the size words from the token set.
  const parsed = parseSizeFromText(`${p.brand ?? ""} ${p.name}`);
  const structured =
    p.contentAmount != null && p.contentUnit ? toBaseUnit(p.contentAmount, p.contentUnit) : null;
  const size = structured ?? parsed.size;

  const tokens = parsed.cleaned
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let words = [...new Set(tokens.filter((t) => !STOPWORDS.has(t)))].sort();
  // Guard: a label that is *only* stopwords/size keeps its words rather than
  // collapsing every such product to one empty key.
  if (words.length === 0) words = [...new Set(tokens)].sort();

  return `${words.join(" ")}|${size ? formatSize(size) : ""}`;
}
