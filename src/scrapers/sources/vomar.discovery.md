# Vomar — source discovery

Re-inspected **2026-08-08**. Vomar is now scraped from its **Publitas folder** with
a small folder-reading engine (`sources/vomar.ts`). This supersedes the earlier
"skipped" note: Vomar still has **no structured product API**, so instead of giving
up we read the leaflet itself — Publitas' own OCR text, and (preferred) a vision
extraction of the page images.

## What Vomar serves

- `vomar.nl/aanbiedingen` → `vomar.nl/folders`, a single **Publitas** embed
  `view.publitas.com/folder-deze-week?publitas_embed=maximized`, which 302-resolves
  to a weekly publication, e.g. `…/folder-deze-week/online-weekendfolder-week-32/`.
- The publication is **image-first**: `spreads.json` lists ~39 page **images**, each
  with an OCR'd `text` blob (`pages[].text`) and image variants
  (`images.at1600`, `at2000`, …, root-relative under `view.publitas.com`). Group /
  publication ids (`96403` / `3289627`) live in the page's asset paths
  (`…/production-revolution-publitas-com/<gId>/<pId>/…`) and **rotate weekly** — never
  hardcode them; resolve from the shortlink each scrape.
- **No product hotspots, no price API.** Across the folder there are ~0 product
  hotspots (only the odd `externalLink`), so — unlike Hoogvliet's Publitas folder —
  there's nothing structured to link to. Shared helpers for this "OCR folder" shape
  live in `sources/publitas.ts` (Hoogvliet keeps its own logic: it reads a *different*
  Publitas deployment whose hotspots link to real product pages, so folding the two
  together would buy nothing and risk regressing a live store).

## The folder-reading engine (tiered, in `vomar.ts`)

Tried cheapest-structured first, falling back to reading pixels:

1. **Tier 1 — hotspots.** Mapped if present; Vomar publishes none today, so this is
   an empty no-op kept so the scraper lights up for free if Vomar ever enables them.
2. **Tier 2 — Publitas OCR text** (`offersFromPublitasText`). Keyless, no AI cost.
   The `pages[].text` is a **jumbled multi-column stream** (the cover interleaves two
   leaflets line-by-line), so the parser favours **precision over recall**: it emits
   an offer only when a run of product-looking name lines is immediately followed by
   a price token (optionally with a promo mechanic), and rejects leaflet copy
   ("Alléén op donderdag…"), packaging lines and descriptions. Yields ~70 best-effort
   offers — usable, but lower quality than vision.
3. **Tier 3 — vision** (`visionExtractPage` → `offersFromExtractedItems`). The
   **recommended primary**: each page image is sent to a vision-capable Claude
   (`@anthropic-ai/sdk`, the same key `translate.ts` uses) with a strict JSON
   extraction prompt; malformed/nameless rows are dropped defensively. Gated behind
   `ANTHROPIC_API_KEY`.

`scrape()` prefers vision when a key is present, else falls back to the OCR text;
each tier degrades rather than crashing, and no tile is emitted without a name **and**
a price or mechanism (repo policy: no fake/uncertain data).

## Validity

Vomar's main folder rolls **Wednesday** (Wed→Tue); a **weekend** sub-folder
("weekendfolder"/"weekendwinner") runs **Thu→Sun**. The printed date on page 1 is
OCR-jumbled and unreliable, so validity is derived from the **ISO week in the slug**
(`…week-32`) plus a weekend flag — a pure function of the (fixed) week, so every
re-scrape in the same period yields the same `validFrom` and offers update one row
instead of drifting across week buckets (offer-plan.ts). The year is inferred (the
slug omits it) by picking the candidate year whose window is nearest today.

## Normalisation notes

- Multi-buy / loyalty language ("1+1 gratis", "2e halve prijs", "N voor P",
  "25% korting", "weekendwinner", "OP=OP") → `offerText`; `normalize.ts` suppresses a
  synthetic percentage for it.
- Beer/wine names ("krat …", "wijn") categorise to ALCOHOL via the name keywords, so
  no store-specific section map is needed (the folder has no sections).

## robots.txt

`www.vomar.nl/robots.txt`: only `/misc/*` disallowed, then `Allow: /`. The Publitas
host serves `spreads.json` / page images without a challenge. We stay gentle:
sequential requests, a short delay, a realistic UA. The one non-`fetch` step is the
optional vision call to the Anthropic API you already use — not a scraping browser.
