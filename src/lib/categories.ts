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
    ZUIVEL: "Zuivel",
    EIEREN: "Eieren",
    KAAS: "Kaas",
    BROOD_BANKET: "Brood & banket",
    DRANKEN: "Dranken",
    ALCOHOL: "Alcohol",
    SODA: "Frisdrank",
    PASTA_RIJST: "Pasta & rijst",
    SNACKS_SNOEP: "Snacks & snoep",
    DIEPVRIES: "Diepvries",
    HOUDBAAR: "Houdbaar",
    ONTBIJT: "Ontbijt",
    DROGISTERIJ: "Drogisterij",
    HUISHOUDEN: "Huishouden",
    BABY_KIND: "Baby & kind",
    HUISDIER: "Huisdier",
  },
  en: {
    GROENTE: "Vegetables",
    FRUIT: "Fruit",
    VLEES: "Meat",
    VIS: "Fish",
    ZUIVEL: "Dairy",
    EIEREN: "Eggs",
    KAAS: "Cheese",
    BROOD_BANKET: "Bread & bakery",
    DRANKEN: "Drinks",
    ALCOHOL: "Alcohol",
    SODA: "Soft drinks",
    PASTA_RIJST: "Pasta & rice",
    SNACKS_SNOEP: "Snacks & sweets",
    DIEPVRIES: "Frozen",
    HOUDBAAR: "Pantry",
    ONTBIJT: "Breakfast",
    DROGISTERIJ: "Drugstore",
    HUISHOUDEN: "Household",
    BABY_KIND: "Baby & kids",
    HUISDIER: "Pets",
  },
};

/** Friendly category label in the given locale. */
export function categoryLabel(category: Category, locale: Locale): string {
  return CATEGORY_LABELS[locale][category] ?? CATEGORY_LABELS.nl[category];
}

/** Categories in the order they should appear in the filter bar. */
export const CATEGORY_ORDER: Category[] = [
  Category.GROENTE,
  Category.FRUIT,
  Category.VLEES,
  Category.VIS,
  Category.ZUIVEL,
  Category.EIEREN,
  Category.KAAS,
  Category.BROOD_BANKET,
  Category.PASTA_RIJST,
  Category.DRANKEN,
  Category.ALCOHOL,
  Category.SODA,
  Category.SNACKS_SNOEP,
  Category.DIEPVRIES,
  Category.ONTBIJT,
  Category.HOUDBAAR,
  Category.DROGISTERIJ,
  Category.HUISHOUDEN,
  Category.BABY_KIND,
  Category.HUISDIER,
];
