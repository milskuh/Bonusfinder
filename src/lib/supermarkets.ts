// src/lib/supermarkets.ts
// Per-supermarket visual identity — a small, typed brand config keyed by
// Supermarket.slug, so an offer card can signal its store at a glance (accent
// bar + logo chip). Modelled on src/lib/categories.ts: a typed config map plus
// a safe accessor with a neutral fallback, so adding a store later is a single
// entry here and an unknown slug never crashes the UI.
//
// Colours live here (the single source of truth per store) rather than as hex
// literals in components. They are close approximations of each chain's brand
// colour — tune against the real logos if needed. `foreground` is chosen to
// stay readable on top of `color`.

export type SupermarketBrand = {
  /** Short uppercase abbreviation, shown when no logo is available. */
  badge: string;
  /** Primary brand colour: the card's accent bar + the store chip background. */
  color: string;
  /** Foreground colour that stays readable on top of `color`. */
  foreground: string;
};

const BRANDS: Record<string, SupermarketBrand> = {
  ah: { badge: "AH", color: "#0071b9", foreground: "#ffffff" }, // Albert Heijn blue
  hoogvliet: { badge: "HV", color: "#e2001a", foreground: "#ffffff" }, // Hoogvliet red
  jumbo: { badge: "JUMBO", color: "#eeb111", foreground: "#000000" }, // Jumbo yellow (black text)
  aldi: { badge: "ALDI", color: "#00b4dc", foreground: "#ffffff" }, // Aldi blue
};

/** Neutral identity for stores not yet in the map (keeps new slugs from crashing). */
const FALLBACK: SupermarketBrand = {
  badge: "",
  color: "#475569", // slate-600 — readable with white foreground
  foreground: "#ffffff",
};

/**
 * Brand identity for a supermarket slug. Unknown slugs get the neutral fallback
 * with a badge derived from the slug, so a newly added store degrades gracefully
 * until it gets its own entry above.
 */
export function supermarketBrand(slug: string): SupermarketBrand {
  return BRANDS[slug] ?? { ...FALLBACK, badge: slug.slice(0, 2).toUpperCase() };
}
