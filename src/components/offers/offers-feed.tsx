"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useOffers } from "@/hooks/use-offers";
import type { OfferSort } from "@/lib/validation/filters";
import { categoryLabel, CATEGORY_ORDER } from "@/lib/categories";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";
import { OfferCard } from "./offer-card";
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
  // `rawQuery` mirrors the input on every keystroke; `query` is the debounced
  // term that actually drives the fetch + URL, so we don't fire a request per
  // keystroke.
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const firstSyncRef = useRef(true);

  // Hydrate the search term from the URL once, so a shared/refreshed link keeps
  // its query. Read post-mount (not a lazy initializer) to avoid an SSR vs.
  // client hydration mismatch on the input value.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
    if (fromUrl) {
      setRawQuery(fromUrl);
      setQuery(fromUrl);
    }
  }, []);

  // Debounce keystrokes (~300 ms) into the effective search term.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [rawQuery]);

  // On a new search term: mirror it to the URL (shareable, refresh-safe) via the
  // history API — this avoids forcing a Suspense boundary that useSearchParams
  // would require. The infinite query resets on its own because `query` is part
  // of the query key. Skip the initial mount so we don't rewrite the URL before
  // hydration. Other filters remain local state, as before.
  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (query) params.set("q", query);
    else params.delete("q");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query]);

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
  }, [query, sort, categories]);

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

      {/* Search (debounced, Postgres FTS) + sort as a segmented control. */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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

      {/* Category filter chips (multi-select; none selected = all). */}
      <div className="mb-7 flex flex-wrap gap-2">
        <button
          onClick={() => setCategories([])}
          aria-pressed={categories.length === 0}
          className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
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
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
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
    </section>
  );
}
