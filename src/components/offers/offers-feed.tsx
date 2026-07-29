"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useOffers } from "@/hooks/use-offers";
import type { OfferSort } from "@/lib/validation/filters";
import { categoryLabel, CATEGORY_ORDER } from "@/lib/categories";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";
import { OfferCard } from "./offer-card";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    <Card className="gap-3 py-4">
      <div className="flex items-center justify-between px-4">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-10" />
      </div>
      <div className="space-y-3 px-4">
        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="px-4">
        <Skeleton className="h-6 w-20" />
      </div>
    </Card>
  );
}

export function OffersFeed() {
  const { t, locale } = useLang();
  const [sort, setSort] = useState<OfferSort>("newest");
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
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

  // On a new search term: reset to page 1 and mirror it to the URL (shareable,
  // refresh-safe) via the history API — this avoids forcing a Suspense boundary
  // that useSearchParams would require. Skip the initial mount so we don't
  // rewrite the URL before hydration. Other filters remain local state, as before.
  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false;
      return;
    }
    setPage(1);
    const params = new URLSearchParams(window.location.search);
    if (query) params.set("q", query);
    else params.delete("q");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query]);

  const { data, isPending, isError, error, isPlaceholderData } = useOffers({
    q: query,
    sort,
    categories,
    page,
    pageSize: PAGE_SIZE,
  });

  const toggleCategory = (cat: string) => {
    setPage(1);
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const clearSearch = () => setRawQuery("");

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("offers.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {data ? t("offers.count", { n: data.total }) : t("offers.loading")}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setSort(s.value);
                setPage(1);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                sort === s.value
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "hover:bg-accent"
              }`}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Search over product names (debounced, backed by Postgres FTS). */}
      <div className="mb-4">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="text"
            enterKeyHint="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQuery(rawQuery.trim());
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="px-9"
          />
          {rawQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={t("search.clear")}
              className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category filter chips (multi-select; none selected = all). */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        <button
          onClick={() => {
            setCategories([]);
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            categories.length === 0
              ? "bg-primary text-primary-foreground border-transparent"
              : "hover:bg-accent"
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
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "hover:bg-accent"
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
      ) : !isPending && data.items.length === 0 ? (
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
        <div
          className={`grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
            isPlaceholderData ? "opacity-60" : ""
          }`}
        >
          {isPending
            ? Array.from({ length: 8 }).map((_, i) => <OfferSkeleton key={i} />)
            : data.items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
        </div>
      )}

      {data && data.pageCount > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-accent"
          >
            {t("pager.prev")}
          </button>
          <span className="text-sm text-muted-foreground">
            {t("pager.page", { page: data.page, count: data.pageCount })}
          </span>
          <button
            onClick={() => setPage((p) => (data && p < data.pageCount ? p + 1 : p))}
            disabled={!!data && page >= data.pageCount}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-accent"
          >
            {t("pager.next")}
          </button>
        </div>
      )}
    </section>
  );
}
