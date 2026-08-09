// src/lib/categories.ts
// Bilingual display labels + a sensible display order for the Category enum,
// shared by the offers filter UI (and anywhere else a friendly label is needed).
import { Category } from "@prisma/client";
import type { Locale } from "@/lib/i18n";

const CATEGORY_LABELS: Record<Locale, Record<Category, string>> = {
  nl: {
    GROENTE: "Groente",
    FRUIT: "Fruit",
    VLEES: "Vlees",
    VIS: "Vis",
    VEGETARISCH: "Vegetarisch",
    ZUIVEL: "Zuivel",
    EIEREN: "Eieren",
    KAAS: "Kaas",
    BROOD_BANKET: "Brood & banket",
    DRANKEN: "Dranken",
    ALCOHOL: "Alcohol",
    SODA: "Frisdrank",
    KOFFIE: "Koffie",
    PASTA_RIJST: "Pasta & rijst",
    SNACKS_SNOEP: "Snacks & snoep",
    DIEPVRIES: "Diepvries",
    HOUDBAAR: "Houdbaar",
    ONTBIJT: "Ontbijt",
    DROGISTERIJ: "Drogisterij",
    HUISHOUDEN: "Huishouden",
    BABY_KIND: "Baby & kind",
    HUISDIER: "Huisdier",
    OVERIG: "Overig",
  },
  en: {
    GROENTE: "Vegetables",
    FRUIT: "Fruit",
    VLEES: "Meat",
    VIS: "Fish",
    VEGETARISCH: "Vegetarian",
    ZUIVEL: "Dairy",
    EIEREN: "Eggs",
    KAAS: "Cheese",
    BROOD_BANKET: "Bread & bakery",
    DRANKEN: "Drinks",
    ALCOHOL: "Alcohol",
    SODA: "Soft drinks",
    KOFFIE: "Coffee",
    PASTA_RIJST: "Pasta & rice",
    SNACKS_SNOEP: "Snacks & sweets",
    DIEPVRIES: "Frozen",
    HOUDBAAR: "Pantry",
    ONTBIJT: "Breakfast",
    DROGISTERIJ: "Drugstore",
    HUISHOUDEN: "Household",
    BABY_KIND: "Baby & kids",
    HUISDIER: "Pets",
    OVERIG: "Other",
  },
};

/** Friendly category label in the given locale. */
export function categoryLabel(category: Category, locale: Locale): string {
  return CATEGORY_LABELS[locale][category] ?? CATEGORY_LABELS.nl[category];
}

/** All selectable categories (unordered — use CATEGORY_ORDER or sortCategoriesByLabel). */
const ALL_CATEGORIES = Object.values(Category) as Category[];

/**
 * Categories sorted alphabetically by their display label in the given locale,
 * so the filter chips read A→Z for whichever language is active. The OVERIG
 * ("Overig" / "Other") catch-all is always pinned last rather than sorted in,
 * since it's a residual bucket, not a real category.
 */
export function sortCategoriesByLabel(locale: Locale): Category[] {
  const sorted = ALL_CATEGORIES.filter((c) => c !== Category.OVERIG).sort(
    (a, b) =>
      categoryLabel(a, locale).localeCompare(categoryLabel(b, locale), locale),
  );
  return [...sorted, Category.OVERIG];
}

/**
 * Default category order for the filter bar (Dutch alphabetical, catch-all last).
 * Prefer sortCategoriesByLabel(locale) in locale-aware UI so the order follows
 * the active language.
 */
export const CATEGORY_ORDER: Category[] = sortCategoriesByLabel("nl");
