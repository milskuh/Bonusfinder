# Vomar — source discovery (NOT scraped)

Live inspection on **2026-08-06**. **No scraper was added** — Vomar has no
structured, reliably-parseable offer source. This note records why, so it can be
revisited if that ever changes.

## What Vomar actually serves

- `https://www.vomar.nl/aanbiedingen` **301-redirects** to `https://www.vomar.nl/folders`,
  a page titled "Onze folder". Its offers are a single **Publitas** leaflet embed:
  `https://view.publitas.com/folder-deze-week/…` (currently
  `online-weekendfolder-week-32`, publication `96403/3289627`).
- The Publitas publication is a **graphical folder**: 39 page **images** (+ OCR'd
  `text` per page) served from `spreads.json`. It exposes the Publitas product /
  hotspot feature (`/product/<id>.json`, `iglu:com.publitas/product/jsonschema`),
  but this publication **does not use it**: across all 39 pages there are only **2
  hotspots**, both `externalLink` (newsletter `ntc.re/…` links) — **zero product
  hotspots, no price fields, no titles**.
- `vomar.nl` itself renders **no** structured offers (no product cards, no
  `__NUXT_DATA__`), and there is **no** offers API: `/api/aanbiedingen`,
  `/api/offers`, `api.vomar.nl/…`, `/graphql`, `/aanbiedingen.json` all 404.

## Why this differs from Hoogvliet (which IS scraped via Publitas)

Hoogvliet's Publitas hotspots link to structured `/aanbiedingen/<id>` product
pages on hoogvliet.com, which the scraper parses. Vomar's folder has no product
hotspots and no structured product pages to link to — only leaflet images and a
jumbled OCR text stream (e.g. `"…5.69 - 5.99 … 50% KORTING … 99 3. … 4.-"`) with
no reliable association between product name, price, pack size and validity.

## Decision

Turning that OCR soup into offers would mean guessing prices off leaflet images —
unreliable, and in direct conflict with the project's core rule of **no
fake/demo/uncertain data**. So Vomar is intentionally **left out** of the registry,
seed and branding. If Vomar later publishes structured offers (a real offers API,
or a Publitas folder with product hotspots), add `sources/vomar.ts` then.

## robots.txt

`www.vomar.nl/robots.txt`: only `/misc/*` Disallowed for `*`, then `Allow: /` —
i.e. nothing here was blocked by robots; the blocker is the **absence of
structured data**, not access.
