"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useOffers } from "@/hooks/use-offers";
import { useSupermarkets } from "@/hooks/use-supermarkets";
import type { OfferSort } from "@/lib/validation/filters";
import { categoryLabel, CATEGORY_ORDER } from "@/lib/categories";
import { supermarketBrand } from "@/lib/supermarkets";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";
import { OfferCard } from "./offer-card";
import { SupermarketLogo } from "./supermarket-logo";
import { Skeleton } from "@/components/ui/skeleton";

const SORTS: { value: OfferSort; labelKey: TKey }[] = [
  { value: "newest", labelKey: "sort.newest" },
  { value: "discount", labelKey: "sort.discount" },
  { value: "price", labelKey: "sort.price" },
  { value: "unitPrice", labelKey: "sort.unitPrice" },
];

const PAGE_SIZE = 24;

function OfferSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="mt-2 h-8 w-24" />
        <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
    </div>
  );
}

export function OffersFeed() {
  const { t, locale } = useLang();
  const [sort, setSort] = useState<OfferSort>("newest");
  const [categories, setCategories] = useState<string[]>([]);
  const [supermarkets, setSupermarkets] = useState<string[]>([]);
  // The stores to offer as chips: only those with active offers (empty until
  // loaded). Failure/empty simply renders no store row — the feed still works.
  const { data: stores = [] } = useSupermarkets();
  // `rawQuery` mirrors the input on every keystroke; `query` is the debounced
  // term that actually drives the fetch + URL, so we don't fire a request per
  // keystroke.
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const firstSyncRef = useRef(true);

  // Hydrate the active filters from the URL once, so a shared/refreshed link
  // keeps its search term, categories and stores. Read post-mount (not a lazy
  // initializer) to avoid an SSR vs. client hydration mismatch. Multi-value
  // params are comma-separated, matching parseOfferFilters on the server.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const list = (key: string) => {
      const v = sp.get(key);
      return v ? v.split(",").filter(Boolean) : [];
    };
    const fromUrl = sp.get("q")?.trim() ?? "";
    if (fromUrl) {
      setRawQuery(fromUrl);
      setQuery(fromUrl);
    }
    const cats = list("categories");
    if (cats.length) setCategories(cats);
    const storeSlugs = list("supermarkets");
    if (storeSlugs.length) setSupermarkets(storeSlugs);
  }, []);

  // Debounce keystrokes (~300 ms) into the effective search term.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [rawQuery]);

  // Mirror the active filters (search term, categories, stores) to the URL so a
  // filtered view is shareable and survives refresh — via the history API, which
  // avoids forcing the Suspense boundary that useSearchParams would require. The
  // infinite query resets on its own because these are part of its query key.
  // Multi-value params are comma-separated, matching parseOfferFilters. Skip the
  // initial mount so we don't rewrite the URL before hydration.
  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const sync = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    sync("q", query);
    sync("categories", categories.join(","));
    sync("supermarkets", supermarkets.join(","));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query, categories, supermarkets]);

  // When the active filters change, jump back to the top. With infinite scroll
  // the page grows very tall, so switching filters while scrolled deep would
  // otherwise strand you at the bottom of the new (often shorter) result set —
  // and the IntersectionObserver below would immediately auto-load pages trying
  // to reach that stale depth, so the freshly filtered offers never show from
  // the start. Skip the first mount to preserve initial/back-navigation scroll.
  const firstScrollRef = useRef(true);
  useEffect(() => {
    if (firstScrollRef.current) {
      firstScrollRef.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [query, sort, categories, supermarkets]);

  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOffers({
    q: query,
    sort,
    categories,
    supermarkets,
    pageSize: PAGE_SIZE,
  });

  // Flatten all fetched pages into one list, de-duplicating by id. Offset
  // pagination can repeat a row across a page boundary (rows sharing a sort key,
  // or a new ingest shifting the window between fetches). The server sorts with
  // a unique tiebreaker (see getOffers) so overlaps shouldn't happen — but a
  // duplicate `key` here would corrupt the grid, so we guard anyway. The total
  // (count across every matching offer) lives on each page — read the first.
  const seen = new Set<string>();
  const offers = (data?.pages.flatMap((p) => p.items) ?? []).filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
  const total = data?.pages[0]?.total ?? null;

  // Infinite scroll: load the next page when the sentinel below the grid nears
  // the viewport. rootMargin pre-fetches ~a screen early so scrolling stays
  // smooth. The effect re-runs when hasNextPage/isFetchingNextPage change, which
  // is also when the sentinel (un)mounts, so the observer always tracks it.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const toggleSupermarket = (slug: string) => {
    setSupermarkets((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  };

  const clearSearch = () => setRawQuery("");

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
          {t("offers.title")}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {total !== null ? t("offers.count", { n: total }) : t("offers.loading")}
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Store filter as a left sidebar (multi-select; none selected = all).
            Only stores with active offers appear; each chip carries its brand
            logo + colour, so a newly added store is styled automatically. A
            horizontal wrapping row on mobile, a vertical list on desktop.
            From lg up it's sticky so it tracks the scroll like the filter bar:
            `self-start` stops the flex item stretching to the row's full height
            (which would leave sticky no room to travel), and `top-0` matches the
            bar since the app header scrolls away. Deliberately NOT sticky on
            mobile — there it's a row stacked above the (also-sticky) filter bar,
            so pinning both would collide them at the top. */}
        {stores.length > 0 && (
          <aside className="lg:sticky lg:top-0 lg:self-start lg:w-48 lg:shrink-0">
            {/* No visible heading — the brand chips make it self-evidently the
                store filter. The accessible name lives on the group instead. */}
            <div
              role="group"
              aria-label={t("filter.stores")}
              className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:items-start"
            >
              <button
                onClick={() => setSupermarkets([])}
                aria-pressed={supermarkets.length === 0}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  supermarkets.length === 0
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {t("filter.all")}
              </button>
              {stores.map((store) => {
                const active = supermarkets.includes(store.slug);
                const brand = supermarketBrand(store.slug);
                return (
                  <button
                    key={store.slug}
                    onClick={() => toggleSupermarket(store.slug)}
                    aria-pressed={active}
                    aria-label={store.name}
                    style={
                      active
                        ? {
                            backgroundColor: brand.color,
                            borderColor: brand.color,
                            color: brand.foreground,
                          }
                        : undefined
                    }
                    className={`inline-flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-sm font-medium transition ${
                      active
                        ? "shadow-sm"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                    }`}
                  >
                    {/* Logo is decorative here — the visible name is the chip's
                        accessible label, so hide it from AT to avoid double-speak. */}
                    <span aria-hidden="true" className="inline-flex">
                      <SupermarketLogo supermarket={store} />
                    </span>
                    <span>{store.name}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Main column: search + sort, category filters, and the results grid. */}
        <div className="min-w-0 flex-1">
          {/* Filter bar — sticky so the sort + category controls stay reachable
              while the grid scrolls beneath it. `top-0` because the app header
              (layout.tsx) is a normal-flow element that scrolls away with the
              page; if it's ever made sticky, offset this by its height. The
              document itself is the scroll container (no overflow:auto/hidden on
              any ancestor), so position:sticky resolves against the viewport.
              The frosted background + bottom border keep grid cards from
              bleeding through as they scroll underneath. */}
          <div className="sticky top-0 z-30 mb-6 flex flex-col gap-3 border-b border-neutral-200 bg-white/80 py-3 backdrop-blur-md">
            {/* Search (debounced, Postgres FTS) + sort as a segmented control. */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-neutral-400"
                  aria-hidden
                />
                <input
                  type="text"
                  enterKeyHint="search"
                  value={rawQuery}
                  onChange={(e) => setRawQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setQuery(rawQuery.trim());
                  }}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.placeholder")}
                  className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pr-10 pl-11 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900"
                />
                {rawQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label={t("search.clear")}
                    className="absolute top-1/2 right-2.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <div className="flex overflow-x-auto rounded-full bg-neutral-100 p-1 text-sm">
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSort(s.value)}
                    aria-pressed={sort === s.value}
                    className={`rounded-full px-3.5 py-1.5 font-medium whitespace-nowrap transition ${
                      sort === s.value
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-800"
                    }`}
                  >
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter chips (multi-select; none selected = all). On
                mobile they scroll horizontally as a single row so the sticky bar
                stays compact; from lg up they wrap onto multiple lines. */}
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-x-visible">
              <button
                onClick={() => setCategories([])}
                aria-pressed={categories.length === 0}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  categories.length === 0
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {t("filter.all")}
              </button>
              {CATEGORY_ORDER.map((cat) => {
                const active = categories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={active}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      active
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                    }`}
                  >
                    {categoryLabel(cat, locale)}
                  </button>
                );
              })}
            </div>
          </div>

          {isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
              {(error as Error).message}
            </div>
          ) : !isPending && offers.length === 0 ? (
            <div className="rounded-lg border px-4 py-12 text-center text-sm text-muted-foreground">
              <p>{t("offers.empty")}</p>
              {query && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="mt-3 rounded-md border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  {t("search.clear")}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {isPending
                ? Array.from({ length: 8 }).map((_, i) => <OfferSkeleton key={i} />)
                : offers.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
            </div>
          )}

          {/* Infinite scroll footer: an invisible sentinel drives fetchNextPage, a
              spinner shows while the next page loads, and once everything is loaded
              a subtle end-of-list marker replaces them. */}
          {!isError && !isPending && offers.length > 0 && (
            <div className="mt-8">
              {hasNextPage ? (
                <>
                  <div ref={sentinelRef} aria-hidden className="h-px w-full" />
                  {isFetchingNextPage && (
                    <div className="flex justify-center py-6">
                      <Loader2
                        className="h-6 w-6 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("offers.end")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
