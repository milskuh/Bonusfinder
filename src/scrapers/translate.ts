// src/scrapers/translate.ts
// Translate Dutch product names to English with Claude. Used by the
// `db:translate` backfill (translate-run.ts). Isolated here so the API-key
// dependency stays out of the scraper/runtime hot path — the app works fully in
// Dutch (and in English for everything except product names) without a key.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";
const BATCH_SIZE = 60; // translate this many names per request.

const SYSTEM =
  "You translate Dutch supermarket product/offer titles into natural, concise " +
  "English, as a grocery app would show them. Keep brand names unchanged " +
  "(e.g. 'Coca-Cola', 'AH', 'Milner', 'Johma'). Keep pack sizes and units. " +
  "Translate one title per input string and return them in the same order. " +
  'Reply with ONLY a JSON object of the form {"translations": ["...", ...]} — ' +
  "no prose, no markdown fences.";

/** True when an API key is available; the caller can bail early with a clear message. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Pull the JSON object out of a model reply, tolerating stray prose or ``` fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start !== -1 && end !== -1 ? body.slice(start, end + 1) : body;
}

async function translateBatch(client: Anthropic, names: string[]): Promise<string[]> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Translate each of these ${names.length} Dutch titles to English. ` +
          `Return {"translations": [...]} with exactly ${names.length} strings ` +
          `in the same order.\n\n${JSON.stringify(names)}`,
      },
    ],
  });

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(extractJson(text)) as { translations?: unknown };
  const out = parsed.translations;
  if (!Array.isArray(out) || out.length !== names.length) {
    throw new Error(`Translation returned ${Array.isArray(out) ? out.length : "?"} of ${names.length} items`);
  }
  return out.map(String);
}

/**
 * Translate Dutch strings to English, preserving order. Processes in batches.
 * `onProgress` reports how many are done so the CLI can show a counter.
 */
export async function translateToEnglish(
  names: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment.
  const result: string[] = [];
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    const batch = names.slice(i, i + BATCH_SIZE);
    result.push(...(await translateBatch(client, batch)));
    onProgress?.(Math.min(i + BATCH_SIZE, names.length), names.length);
  }
  return result;
}
