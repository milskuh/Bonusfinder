# Daily automatic re-scrape — spec & guardrails

**Status:** Implemented 2026-08-09 — schedule flipped to `0 0 * * *` and the
freshness assertion is live in `run.ts`. A manual `workflow_dispatch` run to
confirm green-in-prod is the only open item.
**Owner:** Milan.
**Goal:** Keep the deals on bonusfinder.nu fresh by re-scraping every store once a
day, unattended, at **02:00 Europe/Amsterdam**, without a human in the loop.

This document is the source of truth for *what* the daily scrape does and the
rules it must never break. Read it before changing the workflow, the schedule,
or `src/scrapers/run.ts`. Nothing here is code — it is the contract the code
must satisfy.

---

## 1. Decisions (locked)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Scheduling platform | **GitHub Actions** (`.github/workflows/daily-scrape.yml`) | Free, already secret-safe, logs in the Actions tab, no extra infra. |
| D2 | Time | **02:00 Europe/Amsterdam** | Deep night for NL users → zero user-facing impact, ad sites are quiet. |
| D3 | Translation | **Scrape only.** `db:translate` runs on its own cadence, never in the daily job | Keeps the nightly run fast and $0; Claude API cost stays bounded and deliberate. |
| D4 | Frequency | **Daily full scrape of all default stores** | See §3 — daily is the efficient choice here, not overkill. |
| D5 | Vomar | **Excluded** (stays `DISABLED_BY_DEFAULT` in `run.ts`) | OCR/vision reader isn't production-ready and costs Claude tokens. |

---

## 2. What the job does (today's building blocks — reuse, don't rebuild)

The whole pipeline already exists. The daily job is a thin scheduler around it.

- **Entry point:** `npm run db:scrape` → `tsx src/scrapers/run.ts`.
- **Scrapers run:** hoogvliet, albert-heijn, jumbo, aldi, lidl, dirk, dekamarkt,
  gall, plus (9 stores). Vomar is skipped by default (D5).
- **Runtime:** ~10–15 min, sequential, one store at a time.
- **Persistence (`persist.ts`) is already idempotent and safe to re-run:**
  - Supermarket upserted by slug; logo never overwritten on update.
  - Product matched by normalised `productMatchKey` (folds diacritics,
    punctuation, word order, pack size) → same article across stores collapses
    to one Product. Category/image/url refreshed from the source each run.
  - Offer matched per `(supermarket, ISO week of validFrom)`. New offers
    inserted; offers that dropped out of the ad but are **still inside their
    validity window are left alone**; an offer is deleted **only** once it is
    past `validUntil`.
  - PriceHistory appends a row **only** on first sighting or a price change — a
    daily re-run does not pile up duplicate points.
  - All writes for a store happen in **one transaction** → readers never see a
    half-updated ad.
- **Failure isolation:** a store that throws is logged and sets a non-zero exit
  code, but the loop **continues** to the next store. One broken scraper never
  blocks the other eight.

**Guardrail G1 — never re-implement the write path.** Freshness comes from
re-running the existing idempotent pipeline, not from wiping and reloading.
Deleting live offers and re-inserting is forbidden.

---

## 3. Why daily (the efficiency question, answered)

Dutch supermarket ads are **weekly**, so "scrape every day" looks redundant. It
isn't, and reducing the frequency would cost more than it saves:

- **Mid-week next-week folders.** Several stores publish the *upcoming* week's ad
  mid-week (e.g. Hoogvliet; AH gated by `nextPeriodVisibleFrom`). A weekly scrape
  pinned to one day misses these; a daily scrape catches them the night they go
  live.
- **Corrections & pulled items.** Price fixes and sold-out/withdrawn products
  land any day. Daily keeps the feed honest.
- **Self-healing categorisation.** After a `categorize.ts` change, the next
  nightly run re-buckets every product for free (`persist.ts` refreshes
  `category` on update). No manual `db:recategorize` needed.
- **It's cheap.** GitHub free minutes; idempotent writes; PriceHistory doesn't
  bloat. A daily run costs essentially nothing.

**Conclusion:** keep daily. Spend the "efficiency" budget on *guardrails*
(concurrency, timeout, alerting, optional skip-if-unchanged in §8), **not** on a
lower frequency. Lowering frequency trades a real freshness loss for a
negligible saving — a bad trade.

---

## 4. Schedule (the 02:00 detail)

GitHub Actions cron is **always UTC** and has **no timezone or DST support**.
02:00 Amsterdam is a moving UTC target:

| Season | Amsterdam offset | 02:00 local = |
|--------|------------------|---------------|
| Summer (CEST) | UTC+2 | **00:00 UTC** |
| Winter (CET)  | UTC+1 | **01:00 UTC** |

**Chosen cron: `0 0 * * *` (00:00 UTC daily).**
- Summer → **02:00** Amsterdam (exact).
- Winter → **01:00** Amsterdam (one hour early — still deep night, harmless).

We accept the 1-hour winter drift rather than maintain two DST-switched
schedules. If exact 02:00 year-round ever matters, the fix is documented in §8,
not done now.

**Guardrail G2 — GitHub scheduled runs are best-effort and can be delayed
5–15+ min (worst at the exact top of the hour).** "02:00" is a target, not a
guarantee. Never build logic that assumes the job started at a precise second.
Consider a small minute offset (e.g. `7 0 * * *`) to dodge top-of-hour
congestion.

**Change to make when implementing:** the current committed-but-untracked
`daily-scrape.yml` uses `0 4 * * *`. Update it to `0 0 * * *` and refresh the
comment. That is the *only* schedule change; everything else in that file
already matches this spec.

---

## 5. Guardrails (must hold — checklist for any change)

| ID | Guardrail | Enforced by |
|----|-----------|-------------|
| G1 | Never wipe-and-reload; only the idempotent pipeline writes | `persist.ts` (§2) |
| G2 | Don't assume exact start time | design (§4) |
| G3 | **No overlap** — a run must never collide with the next | `concurrency: { group: daily-scrape, cancel-in-progress: false }` |
| G4 | **Hard timeout** so a hung scraper can't run forever | `timeout-minutes: 30` on the job |
| G5 | **One store failing ≠ whole job failing the data** | per-store try/catch in `run.ts`; job still surfaces non-zero exit for alerting |
| G6 | **Secrets never exposed to forks** | triggers are only `schedule` + `workflow_dispatch`, **never** `pull_request`; `permissions: contents: read` |
| G7 | Vomar stays off in the scheduled run | `DISABLED_BY_DEFAULT` in `run.ts` (D5) |
| G8 | Daily run does **no** paid Claude calls | translation excluded (D3); Vomar excluded (D5) |
| G9 | Reads/writes **production** DB via pooled `DATABASE_URL` + `DIRECT_URL` | repo secrets, same values as Vercel |
| G10 | DB migrations are applied **before** relying on new columns/enums | see §7 — `prisma migrate deploy` is a separate, deliberate step, not part of the nightly job |

**Required repo secrets** (Settings → Secrets and variables → Actions):
`DATABASE_URL` (pooled/PgBouncer), `DIRECT_URL` (direct). `ANTHROPIC_API_KEY` is
**not needed** for the scrape-only job (D3/D5) — keep it out unless Vomar or
translate are ever added.

---

## 6. Observability & alerting

The nightly run is unattended, so a silent failure is the real risk.

- **Where to look:** GitHub → Actions → "Daily scrape" → latest run. `SCRAPE_DEBUG=1`
  prints per-store progress and the `Saved: X new, Y updated, Z expired` line.
- **Success signal:** job exits 0, every store logs a `Found N offers` and a
  `Saved …` line, `N` is in the expected ballpark per store (see the
  per-scraper memory notes for rough counts).
- **Failure signal:** job exits non-zero (any store threw), or a store logs
  `Found 0 offers` when it normally finds dozens (a site layout change).

**Guardrail G11 — a red run must reach a human, and an empty scrape must go
red.** GitHub emails the actor on a failed scheduled run by default; confirm
that notification is on. The **freshness gate in `run.ts`** closes the
"0 offers but green" hole: any store returning fewer than its floor
(`MIN_OFFERS`, default 1) is treated as a failed scrape — its persist is
**skipped** (live offers untouched) and the process exits non-zero, so the
nightly job turns red. The run ends with a `✔ All N store(s) healthy` or a
`✖ Scrape finished with problems …` summary line naming the culprits.

---

## 7. Migrations & the nightly run (ordering rule)

The nightly job runs `npm ci` (which runs `prisma generate`) and `db:scrape`. It
**does not** run `prisma migrate deploy`. If a scraper or category change needs a
new column/enum value:

1. Land the migration and run `prisma migrate deploy` against prod **first**
   (deliberate, reviewed step).
2. Only then merge the scraper change that depends on it.

Running the scrape against a DB missing a required column will throw — that's G10.
Never fold `migrate deploy` into the unattended nightly job.

---

## 8. Explicitly out of scope now (candidate future work)

Documented so they're not silently forgotten — none are built:

- **Skip-if-unchanged.** Hash each store's raw payload; if identical to last
  run, skip persist for that store. Saves DB writes, not scrape time. Marginal;
  only worth it if write volume ever becomes a cost.
- **Zero-offer dead-store alarm — DONE** (freshness gate, §6/G11). Remaining
  future extension: a **relative** drop check (fail if a store drops >X% vs.
  yesterday, not just to zero). Needs yesterday's per-store count from the DB;
  raise a store's `MIN_OFFERS` floor in `run.ts` as a cheap interim.
- **Exact 02:00 year-round.** Two DST-switched cron lines, or move to a
  scheduler with timezone support. Not worth it for a 1-hour winter drift.
- **Translation cadence.** Decide when `db:translate` runs (weekly? on new
  products only?) and its API budget. Separate spec.
- **Retry a single flaky store** without re-running all nine
  (`workflow_dispatch` already allows a manual full re-run today).

---

## 9. Definition of done (for the implementation PR that follows this doc)

- [x] `daily-scrape.yml` schedule is `0 0 * * *` with an accurate DST comment.
- [x] Triggers are exactly `schedule` + `workflow_dispatch` (G6).
- [x] `concurrency` (G3) and `timeout-minutes: 30` (G4) present.
- [x] Only `DATABASE_URL` + `DIRECT_URL` secrets referenced (G8/G9).
- [x] Freshness gate in `run.ts`: below-floor store skips persist + fails run (G11).
- [x] Typecheck + 153 tests green.
- [ ] A manual `workflow_dispatch` run goes green and writes fresh offers to prod.
- [ ] Failure notification confirmed reaching Milan (G11).

---

## 10. Manual operations (runbook)

```bash
# Full scrape to prod (what the nightly job runs)
npm run db:scrape

# One store only
npm run db:scrape -- hoogvliet

# Dry run — scrape + summary, NO DB writes
npm run db:scrape -- --dry

# Re-bucket categories without re-scraping
npm run db:recategorize
```

Trigger the real job by hand: GitHub → Actions → "Daily scrape" → **Run workflow**
(`workflow_dispatch`).
