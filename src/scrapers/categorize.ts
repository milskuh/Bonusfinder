// src/scrapers/categorize.ts
// Maps a scraped product (name + optional subcategory/brand text) onto our
// `Category` enum using Dutch keyword matching. Shared by every scraper so the
// taxonomy stays consistent across supermarkets.
//
// Rules are evaluated top-to-bottom; the FIRST category whose keywords match
// wins, so order encodes priority. This matters for overlaps — e.g. "kipworst"
// hits VLEES before anything else, and SODA is checked before the broader
// DRANKEN so "cola" doesn't get swallowed by generic "drinken".
import { Category } from "@prisma/client";

/** Ordered rules: the first with a keyword hit decides the category. */
const RULES: ReadonlyArray<{ category: Category; keywords: readonly string[] }> = [
  // --- Fish before meat, so "vissticks" / "tonijn" never fall into VLEES. ---
  {
    category: Category.VIS,
    keywords: [
      "vis", "zalm", "tonijn", "haring", "makreel", "kabeljauw", "pangasius",
      "garnaal", "garnalen", "mossel", "scampi", "kibbeling", "lekkerbek",
      "sushi", "surimi", "paling", "forel", "schol", "pilchard", "ansjovis",
      "zeevruchten", "vissticks", "krab",
    ],
  },
  // --- Meat / poultry. ---
  {
    category: Category.VLEES,
    keywords: [
      "vlees", "kip", "kipfilet", "gehakt", "worst", "rundvlees", "varkens",
      "varkensvlees", "biefstuk", "schnitzel", "hamburger", "speklap", "spek",
      "shoarma", "kalkoen", "saucijs", "slavink", "gehaktbal", "rookworst",
      "spareribs", "bacon", "ham", "salami", "cordon bleu", "runder", "lamsvlees",
      "drumstick", "kipdij", "kippenpoot", "braadworst",
    ],
  },
  // --- Soda / soft drinks, checked before the broader DRANKEN. ---
  {
    category: Category.SODA,
    keywords: [
      "cola", "coca-cola", "pepsi", "fanta", "sprite", "7up", "seven up",
      "frisdrank", "sinas", "cassis", "tonic", "bitter lemon", "ginger ale",
      "energydrink", "energy drink", "red bull", "monster", "aa drink",
      "dubbelfris", "royal club", "rivella", "sourcy", "spa fruit", "ice tea",
      "icetea", "lipton", "fuze tea", "limonade", "ranja", "siroop",
    ],
  },
  // --- Other drinks (juice, water, coffee, tea, alcohol). ---
  {
    category: Category.DRANKEN,
    keywords: [
      "sap", "jus", "juice", "smoothie", "water", "spa", "bronwater", "koffie",
      "capsule", "espresso", "senseo", "nespresso", "thee", "bier", "pils",
      "wijn", "rosé", "prosecco", "cava", "champagne", "wodka", "whisky",
      "rum", "likeur", "gin", "aperitief", "port", "drank",
    ],
  },
  // --- Eggs before dairy, so "eieren" doesn't fall into ZUIVEL. ---
  {
    category: Category.EIEREN,
    keywords: ["eieren", "ei", "eitje", "eitjes", "scharrelei", "scharreleieren"],
  },
  // --- Dairy (no eggs). ---
  {
    category: Category.ZUIVEL,
    keywords: [
      "melk", "yoghurt", "yoghurtdrink", "kwark", "vla", "room", "slagroom",
      "boter", "roomboter", "margarine", "karnemelk",
      "chocomel", "fristi", "optimel", "danio", "kefir", "toetje", "pudding",
    ],
  },
  {
    category: Category.KAAS,
    keywords: [
      "kaas", "kaasplak", "mozzarella", "brie", "camembert", "geraspte",
      "parmezaan", "feta", "roomkaas", "smeerkaas", "milner", "gouda", "belegen",
    ],
  },
  {
    category: Category.BROOD_BANKET,
    keywords: [
      "brood", "stokbrood", "bolletjes", "croissant", "gebak", "taart", "cake",
      "koekje", "banket", "bakkerij", "pistolet", "beschuit", "crackers",
      "muffin", "donut", "appeltaart", "vlaai",
    ],
  },
  // --- Fruit before vegetables (both split out of the old GROENTE_FRUIT). ---
  {
    category: Category.FRUIT,
    keywords: [
      "fruit", "appel", "banaan", "banane", "sinaasappel", "druiven", "druif",
      "aardbei", "aardbeien", "mango", "peer", "peren", "citroen", "meloen",
      "kiwi", "ananas", "perzik", "nectarine", "framboos", "frambozen", "bessen",
      "blauwe bes", "braam", "bramen", "pruim", "abrikoos", "kersen", "mandarijn",
      "clementine", "grapefruit", "avocado",
    ],
  },
  {
    category: Category.GROENTE,
    keywords: [
      "groente", "aardappel", "tomaat", "komkommer", "sla", "ijsbergsla",
      "ijsberg", "kropsla", "salade", "paprika", "ui", "uien", "wortel",
      "broccoli", "champignon", "spinazie", "courgette", "bloemkool", "prei",
      "boon", "bonen", "sperzieboon", "erwt", "andijvie", "witlof", "rucola",
      "radijs", "asperge", "knoflook", "pompoen", "biet", "spruit", "spitskool",
      "snackgroente", "snackgroenten",
    ],
  },
  {
    category: Category.ONTBIJT,
    keywords: [
      "ontbijt", "muesli", "cornflakes", "cruesli", "hagelslag", "pindakaas",
      "jam", "havermout", "brinta", "ontbijtkoek", "vlokken", "granola",
    ],
  },
  {
    category: Category.DIEPVRIES,
    keywords: [
      "diepvries", "pizza", "ijs", "roomijs", "magnum", "ben & jerry",
      "frites", "friet", "diepvriespizza", "loempia",
    ],
  },
  {
    category: Category.SNACKS_SNOEP,
    keywords: [
      "chips", "zoutjes", "noten", "borrelnoot", "snoep", "chocolade", "chocola",
      "reep", "koek", "biscuit", "drop", "winegum", "pinda", "popcorn", "toffee",
      "m&m", "snickers", "haribo", "stroopwafel", "tuc", "cracker",
    ],
  },
  {
    category: Category.DROGISTERIJ,
    keywords: [
      "tandpasta", "shampoo", "douchegel", "deodorant", "zeep", "crème",
      "bodylotion", "scheer", "tandenborstel", "maandverband", "tampon",
      "verzorging", "vitamine", "paracetamol", "pleister", "mondwater", "dove",
    ],
  },
  {
    category: Category.HUISHOUDEN,
    keywords: [
      "wasmiddel", "wasverzachter", "afwasmiddel", "vaatwas", "schoonmaak",
      "allesreiniger", "toiletpapier", "keukenrol", "vuilniszak", "aluminiumfolie",
      "wc-papier", "luchtverfrisser", "afwas", "glansspoel", "wasgel",
    ],
  },
  {
    category: Category.BABY_KIND,
    keywords: [
      "luier", "baby", "babyvoeding", "billendoekjes", "olvarit", "nutrilon",
      "zwitsal", "pampers", "kinder", "flesvoeding",
    ],
  },
  {
    category: Category.HUISDIER,
    keywords: [
      "hondenvoer", "kattenvoer", "hond", "kat", "dierenvoer", "whiskas",
      "felix", "pedigree", "kattenbak", "brokjes", "huisdier", "frolic",
    ],
  },
  // --- Pasta / rice / world cuisine, before the HOUDBAAR catch-all. ---
  {
    category: Category.PASTA_RIJST,
    keywords: [
      "pasta", "spaghetti", "penne", "macaroni", "lasagne", "tagliatelle",
      "fusilli", "rijst", "risotto", "noedels", "noodles", "mie", "bami", "nasi",
      "couscous", "quinoa", "wereldkeuken", "wrap", "wraps", "tortilla", "taco",
    ],
  },
  {
    category: Category.HOUDBAAR,
    keywords: [
      "saus", "soep", "conserven", "olie", "azijn", "kruiden", "bouillon",
      "meel", "suiker", "ketchup", "mayonaise", "curry", "blik", "pot",
    ],
  },
];

const normalize = (s: string) => s.toLowerCase();

const isWordChar = (c: string) => /[a-z0-9]/.test(c);

/**
 * Does `keyword` occur at the START of a word in `haystack`? This keeps Dutch
 * compound matching ("kip" → "kipfilet") while avoiding mid-word false hits
 * (the keyword "ei" must not match "klein", "ham" must not match "shampoo").
 */
function matchesWordStart(haystack: string, keyword: string): boolean {
  let i = haystack.indexOf(keyword);
  while (i !== -1) {
    if (i === 0 || !isWordChar(haystack[i - 1])) return true;
    i = haystack.indexOf(keyword, i + 1);
  }
  return false;
}

/**
 * Best-effort category for a scraped product. Combines the product name with
 * any subcategory/brand hints the source gives. Falls back to HOUDBAAR (the
 * generic "ambient groceries" bucket) when nothing matches.
 */
export function categorize(
  name: string,
  hints: (string | null | undefined)[] = [],
): Category {
  const haystack = normalize([name, ...hints].filter(Boolean).join(" "));
  for (const { category, keywords } of RULES) {
    for (const kw of keywords) {
      if (matchesWordStart(haystack, kw)) return category;
    }
  }
  return Category.HOUDBAAR;
}
