// src/lib/queries/search.ts
// Gedeelde bouwstenen voor vrije-tekst zoeken tegen Product.searchVector.
//
// Achtergrond: searchVector bevat *lexemen* (gestemde hele woorden, Dutch config
// — zie prisma/fts_setup.sql). websearch_to_tsquery/plainto_tsquery matchen dus
// alleen complete woorden: "chocola" wordt lexeme "chocol"/"chocola", maar de
// opgeslagen naam "Chocolade" levert lexeme "chocolad" → geen match, 0 resultaten.
// Gebruikers verwachten type-ahead (prefix) gedrag. Daarvoor bouwen we een
// prefix-tsquery ("chocola:*") en voeren die met to_tsquery uit (plainto_/
// websearch_ escapen de `:*` operator en breken prefix-matching).
//
// De input wordt gestript tot letters/cijfers, dus gebruikersinvoer kan nooit
// tsquery-operators (& | ! ( ) : *) injecteren of een syntax-error veroorzaken
// die stilletjes een lege resultset oplevert.

/**
 * Zet vrije gebruikersinvoer om in een veilige Postgres prefix-tsquery string.
 * "chocola"        -> "chocola:*"
 * "beste chocola"  -> "beste:* & chocola:*"
 * "m&m's"          -> "m:* & m:* & s:*"   (operators gestript, nooit geïnjecteerd)
 * ""               -> null                 (caller slaat de zoek-filter over)
 */
export function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    // houd unicode letters/cijfers (incl. accenten), vervang de rest door spaties
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

/**
 * Escape de LIKE-jokertekens (% en _) én de escape-char (\) in gebruikersinvoer,
 * zodat een ILIKE-fallback de invoer als letterlijke substring behandelt in plaats
 * van als patroon. Postgres gebruikt standaard `\` als LIKE escape-char.
 */
export function likeEscape(input: string): string {
  return input.replace(/[\\%_]/g, (m) => "\\" + m);
}
