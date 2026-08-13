// src/scrapers/categorize.ts
// Maps a scraped product (name + optional brand/section hints) onto our
// `Category` enum. Shared by every scraper so the taxonomy stays consistent
// across supermarkets.
//
// The classifier is a small TIERED pipeline (highest-trust signal first):
//
//   Tier 0  source-trust   — when the caller passes the source's own section
//                            label (e.g. Gall = a liquor store, an AH "Drogisterij"
//                            section), trust it. A section a human filed the deal
//                            under beats any keyword guess.
//   Tier 1  non-food gate  — route general merchandise / personal care (frying
//                            pans, sunscreen, wipes) to their non-food bucket and
//                            short-circuit BEFORE the food rules, so a food stem
//                            buried in a product name ("koek" in "koekenpan") can't
//                            claim them.
//   Tier 2  food rules     — the ordered Dutch keyword rules. First match wins, so
//                            order encodes priority (VEGETARISCH before the animal
//                            buckets; ALCOHOL before SODA; …).
//   fallback OVERIG        — the catch-all when nothing matches.
//
// Matching is boundary-aware (see match.ts). Each keyword is a `Pattern`:
//   word("ui")            → whole token only ("rode ui", not "uitsmijter")
//   prefix("kip")         → Dutch-compound-friendly ("kip" → "kipfilet")
//   prefix("koek",[...])  → prefix minus known exceptions ("koek" but not "koekenpan")
//   phrase("gin tonic")   → multi-word / hyphenated substring on the whole name
//
// Rule of thumb: a bare `prefix` is only for genuine food stems that commonly form
// compounds (kip, rund, aardappel, appel…). Anything short and collision-prone
// (vis, ijs, ham, koek, water) is `word` or `prefix` + `except`.
import { Category } from "@prisma/client";
import { normalizeName, tokenize, patternMatches, word, prefix, phrase, type Pattern } from "./match";

type Rule = { category: Category; patterns: readonly Pattern[] };

// --- Tier 2: ordered food (and general) keyword rules -----------------------
// First rule with a matching pattern decides the category, so order is priority.
const RULES: readonly Rule[] = [
  // Vegetarian / vegan FIRST: these deliberately imitate meat/fish ("vegetarische
  // kipstukjes", plant "tonijn"), so their names carry VLEES/VIS/GROENTE words.
  // Running first (with a deliberately TIGHT list) routes them here, not into the
  // animal buckets. Excluded on purpose: bare "plantaardig" (too broad).
  {
    category: Category.VEGETARISCH,
    patterns: [
      prefix("vegetarisch"), prefix("vegan"), prefix("veggie"), prefix("vleesvervang"),
      prefix("tofu"), prefix("tempeh"), prefix("seitan"), prefix("quorn"), prefix("falafel"),
      // NL substitute brands whose names carry no veg/vegan word.
      prefix("vivera"), phrase("garden gourmet"), prefix("beyond"), prefix("goodbite"), prefix("schouten"),
    ],
  },
  // Fish before meat, so "vissticks"/"tonijn" never fall into VLEES.
  {
    category: Category.VIS,
    patterns: [
      // "vis" is collision-prone ("Vision", "visite") → prefix minus those.
      prefix("vis", ["vision", "visie", "visite", "viscose", "visagie"]),
      prefix("zalm"), prefix("tonijn"), prefix("haring"), prefix("makreel"), prefix("kabeljauw"),
      prefix("pangasius"), prefix("garnaal"), prefix("garnalen"), prefix("mossel"), prefix("scampi"),
      prefix("kibbeling"), prefix("lekkerbek"), prefix("sushi"), prefix("surimi"), prefix("paling"),
      prefix("forel"), prefix("schol"), prefix("pilchard"), prefix("ansjovis"), prefix("zeevruchten"),
      prefix("vissticks"), prefix("krab"),
    ],
  },
  // Meat / poultry.
  {
    category: Category.VLEES,
    patterns: [
      // "*worst"/"*karbonade" are SUFFIX compounds ("grillworst", "ribkarbonade")
      // → phrase (substring). "ham" is collision-prone → prefix minus "hamkas"
      // (the Hamka's snack) and "hamster" (a pet); "hamburger" still matches VLEES.
      prefix("vlees"), prefix("kip"), prefix("kipfilet"), prefix("gehakt"), phrase("worst"),
      prefix("rundvlees"), prefix("varkens"), prefix("varkensvlees"), prefix("biefstuk"),
      prefix("schnitzel"), prefix("hamburger"), prefix("speklap"), prefix("spek"), prefix("shoarma"),
      prefix("kalkoen"), prefix("saucijs"), prefix("saucijzen"), prefix("slavink"), prefix("gehaktbal"),
      prefix("spareribs"), prefix("bacon"), prefix("ham", ["hamkas", "hamster"]), prefix("beenham"),
      prefix("achterham"), prefix("salami"), phrase("cordon bleu"), prefix("runder"), prefix("lamsvlees"),
      prefix("drumstick"), prefix("kipdij"), prefix("kippenpoot"), phrase("karbonade"), prefix("buikspek"),
      prefix("chipolata"), prefix("kabanos"), prefix("chorizo"), word("pate"), prefix("hotdog"),
      phrase("pulled pork"), phrase("corned beef"),
    ],
  },
  // Alcohol (beer, wine, spirits) BEFORE the soft drinks, so a mixer named
  // "Gin Tonic" / "Bombay Sapphire & Tonic" / "Hard Lemonade" resolves to ALCOHOL
  // even though it also carries the SODA words "tonic"/"lemonade". "gin" is a whole
  // word (never the prefix of "ginger ale"); a bare "tonic" with no alcohol
  // co-signal stays SODA below. Non-alcoholic 0.0 look-alikes are handled per-source
  // (see gall.ts / the Tier-0 source-trust rule).
  {
    category: Category.ALCOHOL,
    patterns: [
      // "*bier" is a suffix compound ("craftbier", "witbier", "bokbier") → phrase.
      phrase("bier"), prefix("pils"), prefix("pilsener"), prefix("radler"), prefix("wijn"),
      word("rose"), prefix("prosecco"), prefix("cava"), prefix("champagne"), prefix("mousserend"),
      prefix("wodka"), prefix("vodka"), prefix("whisky"), prefix("whiskey"), prefix("bourbon"),
      prefix("rum"), prefix("likeur"), word("gin"), prefix("jenever"), prefix("vieux"),
      prefix("cognac"), prefix("brandy"), prefix("vermout"), prefix("vermouth"), prefix("tequila"),
      prefix("sherry"), word("port"), prefix("aperitief"), prefix("gedistilleerd"),
      // Spirit/mixer phrases + brands that carry a soft-drink word but are alcohol.
      phrase("gin tonic"), phrase("hard lemonade"), phrase("hard seltzer"),
      phrase("bombay sapphire"), prefix("stelz"), prefix("bacardi"), prefix("jameson"),
    ],
  },
  // Soda / soft drinks, after ALCOHOL (above) and before the broader DRANKEN.
  {
    category: Category.SODA,
    patterns: [
      prefix("cola"), phrase("coca-cola"), prefix("pepsi"), prefix("fanta"), prefix("sprite"),
      prefix("7up"), phrase("seven up"), prefix("frisdrank"), prefix("sinas"), prefix("cassis"),
      prefix("tonic"), phrase("bitter lemon"), phrase("ginger ale"), prefix("energydrink"),
      phrase("energy drink"), phrase("red bull"), prefix("monster"), phrase("aa drink"),
      prefix("dubbelfris"), phrase("royal club"), prefix("rivella"), prefix("sourcy"),
      phrase("spa fruit"), phrase("ice tea"), prefix("icetea"), prefix("lipton"), phrase("fuze tea"),
      prefix("limonade"), prefix("ranja"), prefix("siroop"),
    ],
  },
  // Coffee, before the generic DRANKEN so it gets its own bucket. AFTER ALCOHOL so
  // a coffee *liqueur* stays ALCOHOL. "koffie" (prefix) catches -bonen/-pads/-cups.
  {
    category: Category.KOFFIE,
    patterns: [
      prefix("koffie"), prefix("oploskoffie"), prefix("filterkoffie"), prefix("snelfilter"),
      prefix("espresso"), prefix("cappuccino"), prefix("lungo"), prefix("ristretto"),
      prefix("macchiato"), prefix("latte"), prefix("senseo"), prefix("nespresso"), prefix("nescafe"),
      phrase("dolce gusto"), prefix("segafredo"), prefix("barissimo"), prefix("kanis"),
      phrase("douwe egberts"),
    ],
  },
  // Other (non-alcoholic) drinks: juice, water, tea. "water" is a WHOLE WORD (kills
  // "waterborstel"/"waterwipes"/"waterkoker"); "spa" a whole word (kills "spaghetti").
  {
    category: Category.DRANKEN,
    patterns: [
      prefix("sap"), prefix("jus"), prefix("juice"), prefix("smoothie"), word("water"),
      word("spa"), prefix("bronwater"), prefix("thee"), prefix("drank"),
    ],
  },
  // Eggs before dairy, so "eieren" doesn't fall into ZUIVEL.
  {
    category: Category.EIEREN,
    patterns: [prefix("eieren"), prefix("ei"), prefix("eitje"), prefix("eitjes"), prefix("scharrelei"), prefix("scharreleieren")],
  },
  // Dairy (no eggs).
  {
    category: Category.ZUIVEL,
    patterns: [
      prefix("melk"), prefix("yoghurt"), prefix("yoghurtdrink"), prefix("kwark"), prefix("vla"),
      prefix("room"), prefix("slagroom"), prefix("boter"), prefix("roomboter"), prefix("margarine"),
      prefix("karnemelk"), prefix("chocomel"), prefix("fristi"), prefix("optimel"), prefix("danio"),
      prefix("kefir"), prefix("toetje"), prefix("pudding"),
    ],
  },
  {
    category: Category.KAAS,
    patterns: [
      // No bare "gouda" (the "Gouda's Glorie" sauce line); real Gouda carries
      // "kaas"/"belegen". No "goudse" either (it would swallow "Goudse stroopwafels").
      prefix("kaas"), prefix("kaasplak"), prefix("mozzarella"), prefix("brie"), prefix("camembert"),
      prefix("geraspte"), prefix("parmezaan"), prefix("feta"), prefix("roomkaas"), prefix("smeerkaas"),
      prefix("milner"), prefix("belegen"), prefix("strooikaas"),
    ],
  },
  {
    category: Category.BROOD_BANKET,
    patterns: [
      // "*brood" is a suffix compound ("volkorenbrood", "tijgerbrood", "casinobrood")
      // → phrase, so the very common bread compounds don't fall through to OVERIG.
      phrase("brood"), prefix("bolletjes"), prefix("croissant"), prefix("gebak"),
      prefix("taart"), prefix("cake"), prefix("koekje"), prefix("banket"), prefix("bakkerij"),
      prefix("pistolet"), prefix("beschuit"), prefix("crackers"), prefix("muffin"), prefix("donut"),
      prefix("appeltaart"), prefix("vlaai"), prefix("oliebol"),
    ],
  },
  // Fruit before vegetables.
  {
    category: Category.FRUIT,
    patterns: [
      prefix("fruit"), prefix("appel"), prefix("banaan"), prefix("banane"), prefix("sinaasappel"),
      prefix("druiven"), prefix("druif"), prefix("aardbei"), prefix("aardbeien"), prefix("mango"),
      prefix("peer"), prefix("peren"), prefix("citroen"), prefix("meloen"), prefix("kiwi"),
      prefix("ananas"), prefix("perzik"), prefix("nectarine"), prefix("framboos"), prefix("frambozen"),
      prefix("bessen"), phrase("blauwe bes"), prefix("braam"), prefix("bramen"), prefix("pruim"),
      prefix("abrikoos"), prefix("kersen"), prefix("mandarijn"), prefix("clementine"),
      prefix("grapefruit"), prefix("avocado"),
    ],
  },
  {
    category: Category.GROENTE,
    patterns: [
      // "ui" (onion) is a WHOLE WORD: word-start wrongly hit "Uiltje"/"uitsmijter".
      // "*peen" is a suffix (bospeen/waspeen/winterpeen) → phrase.
      prefix("groente"), prefix("aardappel"), prefix("tomaat"), prefix("komkommer"), prefix("sla"),
      prefix("ijsbergsla"), prefix("ijsberg"), prefix("kropsla"), prefix("salade"), prefix("paprika"),
      word("ui"), prefix("uien"), prefix("wortel"), prefix("broccoli"), prefix("champignon"),
      prefix("spinazie"), prefix("courgette"), prefix("bloemkool"), prefix("prei"), prefix("boon"),
      prefix("bonen"), prefix("sperzieboon"), prefix("erwt"), prefix("andijvie"), prefix("witlof"),
      prefix("rucola"), prefix("radijs"), prefix("asperge"), prefix("knoflook"), prefix("pompoen"),
      prefix("biet"), prefix("spruit"), prefix("spitskool"), prefix("snackgroente"),
      prefix("snackgroenten"), prefix("rauwkost"), phrase("peen"),
    ],
  },
  {
    category: Category.ONTBIJT,
    patterns: [
      prefix("ontbijt"), prefix("muesli"), prefix("cornflakes"), prefix("cruesli"), prefix("hagelslag"),
      prefix("pindakaas"), prefix("jam"), prefix("havermout"), prefix("brinta"), prefix("ontbijtkoek"),
      prefix("vlokken"), prefix("granola"),
    ],
  },
  {
    category: Category.DIEPVRIES,
    patterns: [
      prefix("diepvries"), prefix("pizza"), prefix("ijs", ["ijscrusher", "ijsmaker", "ijsmachine"]),
      prefix("roomijs"), prefix("magnum"), phrase("ben & jerry"), prefix("frites"), prefix("friet"),
      prefix("diepvriespizza"), prefix("loempia"),
    ],
  },
  {
    category: Category.SNACKS_SNOEP,
    patterns: [
      // "koek" is collision-prone → prefix minus the "koekenpan" frying pan.
      prefix("chips"), prefix("zoutjes"), prefix("noten"), prefix("borrelnoot"), prefix("snoep"),
      prefix("chocolade"), prefix("chocola"), prefix("reep"), prefix("koek", ["koekenpan", "koekpan"]),
      prefix("biscuit"), prefix("drop"), prefix("winegum"), prefix("pinda"), prefix("popcorn"),
      prefix("toffee"), phrase("m&m"), prefix("snickers"), prefix("haribo"), prefix("stroopwafel"),
      prefix("tuc"), prefix("cracker"), prefix("oreo"),
      // Well-known crisp/snack brands whose names carry no generic snack word.
      prefix("cheetos"), prefix("wokkels"), prefix("bugles"), prefix("hamka"), prefix("doritos"),
      prefix("lays"), prefix("pringles"), prefix("nibbits"),
    ],
  },
  {
    category: Category.DROGISTERIJ,
    patterns: [
      prefix("tandpasta"), prefix("shampoo"), prefix("douchegel"), prefix("deodorant"), prefix("zeep"),
      prefix("creme"), prefix("bodylotion"), prefix("scheer"), prefix("tandenborstel"),
      prefix("maandverband"), prefix("tampon"), prefix("verzorging"), prefix("vitamine"),
      prefix("paracetamol"), prefix("pleister"), prefix("mondwater"), prefix("dove"),
    ],
  },
  {
    category: Category.HUISHOUDEN,
    patterns: [
      prefix("wasmiddel"), prefix("wasverzachter"), prefix("afwasmiddel"), prefix("vaatwas"),
      prefix("schoonmaak"), prefix("allesreiniger"), prefix("toiletpapier"), prefix("keukenrol"),
      prefix("vuilniszak"), prefix("aluminiumfolie"), phrase("wc-papier"), prefix("luchtverfrisser"),
      prefix("afwas"), prefix("glansspoel"), prefix("wasgel"),
      // Pest control (non-food): "insect" covers insecten/-spray/-verdelger.
      prefix("insect"), prefix("muggen"), prefix("mieren"), prefix("wespen"), prefix("ongedierte"),
    ],
  },
  {
    category: Category.BABY_KIND,
    patterns: [
      prefix("luier"), prefix("baby"), prefix("babyvoeding"), prefix("billendoekjes"), prefix("olvarit"),
      prefix("nutrilon"), prefix("zwitsal"), prefix("pampers"), prefix("kinder"), prefix("flesvoeding"),
    ],
  },
  {
    category: Category.HUISDIER,
    patterns: [
      prefix("hondenvoer"), prefix("kattenvoer"), prefix("hond"), prefix("kat"), prefix("dierenvoer"),
      prefix("whiskas"), prefix("felix"), prefix("pedigree"), prefix("kattenbak"), prefix("brokjes"),
      prefix("huisdier"), prefix("frolic"),
    ],
  },
  // Pasta / rice / world cuisine, before the HOUDBAAR catch-all.
  {
    category: Category.PASTA_RIJST,
    patterns: [
      prefix("pasta"), prefix("spaghetti"), prefix("penne"), prefix("macaroni"), prefix("lasagne"),
      prefix("tagliatelle"), prefix("fusilli"), prefix("rijst"), prefix("risotto"), prefix("noedels"),
      prefix("noodles"), prefix("mie"), prefix("bami"), prefix("nasi"), prefix("couscous"),
      prefix("quinoa"), prefix("wereldkeuken"), prefix("wrap"), prefix("wraps"), prefix("tortilla"),
      prefix("taco"),
    ],
  },
  {
    category: Category.HOUDBAAR,
    patterns: [
      // "*saus"/"*soep"/"*olie" are suffix compounds ("barbecuesaus", "tomatensoep",
      // "olijfolie") → phrase. Earlier rules still win ("kippensoep" → VLEES); the
      // "oliebol" pastry is caught by BROOD_BANKET before "olie" is seen.
      phrase("saus"), phrase("soep"), prefix("conserven"), phrase("olie"), prefix("azijn"),
      prefix("kruiden"), prefix("bouillon"), prefix("meel"), prefix("suiker"), prefix("ketchup"),
      prefix("mayonaise"), prefix("curry"), prefix("blik"), prefix("pot"),
    ],
  },
];

// --- Tier 1: non-food gate (runs BEFORE the food rules) ---------------------
// General merchandise / personal care, matched with SPECIFIC compound tokens
// (`koekenpan`, not bare `pan`) so a food name can't over-match. Every token here
// is justified by a fixture row (categorize.fixtures.ts); add a token → run the
// fixtures → if a control row breaks, the token is too broad.
const NON_FOOD_RULES: readonly Rule[] = [
  {
    category: Category.BABY_KIND,
    patterns: [word("waterwipes"), word("wipes"), word("billendoekjes"), word("luiers")],
  },
  {
    category: Category.DROGISTERIJ,
    patterns: [
      word("zonbescherming"), word("zonnebrand"), word("zonnecreme"), word("aftersun"),
      word("biodermal"), phrase("vision zonbescherming"),
    ],
  },
  {
    category: Category.HUISHOUDEN,
    patterns: [
      word("koekenpan"), word("steelpan"), word("borstel"), word("waterborstel"), word("spanband"),
      word("crusher"), word("ijscrusher"), word("slushymaker"), word("telescopisch"),
      word("telescopische"),
    ],
  },
];

// --- Tier 0: source-trust ----------------------------------------------------
// Map a supermarket's own section/aisle label straight to a Category. A section a
// human filed the deal under is a stronger signal than a keyword guess, so it runs
// first when the caller threads it through. Keyed by the raw label as the source
// spells it; extend per source.
const SECTION_MAP: Record<string, Category> = {
  // Non-food aisles (AH / DekaMarkt spellings) — the classes keywords miss most.
  Drogisterij: Category.DROGISTERIJ,
  Huishouden: Category.HUISHOUDEN,
  "Baby en kind": Category.BABY_KIND,
  "Baby & kind": Category.BABY_KIND,
  Huisdier: Category.HUISDIER,
};

/**
 * Highest-trust tier: resolve from the source's own signal, or null to fall
 * through to the keyword tiers.
 *  - Gall & Gall is a liquor store: default everything to ALCOHOL unless the name
 *    clearly says it's an alcohol-free variant (then let the food rules pick SODA).
 *  - Any source may pass a `section` label we recognise (SECTION_MAP).
 */
function sourceTrust(
  nameNorm: string,
  opts: { source?: string | null; section?: string | null },
): Category | null {
  const section = opts.section?.trim();
  if (section && section in SECTION_MAP) return SECTION_MAP[section];

  if (opts.source === "gall") {
    const alcoholFree = /alcoholvrij|alcoholarm|\b0[.,]0\s*%?\b/.test(nameNorm);
    if (!alcoholFree) return Category.ALCOHOL;
  }
  return null;
}

/** First rule in `rules` with a matching pattern, or null. */
function classify(tokens: readonly string[], nameNorm: string, rules: readonly Rule[]): Category | null {
  for (const { category, patterns } of rules) {
    for (const p of patterns) {
      if (patternMatches(p, tokens, nameNorm)) return category;
    }
  }
  return null;
}

/** Run the non-food gate then the food rules over one text. */
function classifyTiered(text: string): Category | null {
  const nameNorm = normalizeName(text);
  const tokens = tokenize(text);
  return classify(tokens, nameNorm, NON_FOOD_RULES) ?? classify(tokens, nameNorm, RULES);
}

/**
 * Options a caller may thread through to the classifier. Everything is optional so
 * existing callers — `categorize(name)` / `categorize(name, hints)` — keep working.
 */
export interface CategorizeOptions {
  /** The scraper slug, e.g. "gall", enabling per-source trust rules. */
  source?: string | null;
  /** The source's own section/aisle label for this product, if it carries one. */
  section?: string | null;
}

/**
 * Best-effort category for a scraped product. Precedence:
 *   source-trust (§Tier 0) → non-food gate + food rules on the NAME → the same on
 *   name + hints → OVERIG.
 *
 * The product NAME is authoritative: if it carries any keyword we classify on it
 * alone, so a broad hint (a brand like "Uiltje", a marketing subtitle mentioning
 * "groente") can't drag a product into the wrong bucket. Only when the name is
 * inconclusive do we fold in the source's hints (brand / pack size / section).
 * Falls back to OVERIG (the catch-all) rather than HOUDBAAR, which is a real pantry
 * category reached via its own keywords.
 */
export function categorize(
  name: string,
  hints: (string | null | undefined)[] = [],
  opts: CategorizeOptions = {},
): Category {
  // Tier 0: the source's own signal wins when the caller provides it.
  const bySource = sourceTrust(normalizeName(name), opts);
  if (bySource != null) return bySource;

  // Tiers 1–2 on the NAME alone (name-first).
  const byName = classifyTiered(name);
  if (byName != null) return byName;

  // Fall back to name + hints.
  const withHints = classifyTiered([name, ...hints].filter(Boolean).join(" "));
  return withHints ?? Category.OVERIG;
}
