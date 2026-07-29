"use client";

import { useState } from "react";
import { useOffers } from "@/hooks/use-offers";
import type { OfferSort } from "@/lib/validation/filters";
import { categoryLabel, CATEGORY_ORDER } from "@/lib/categories";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";
import { OfferCard } from "./offer-card";
import { Card } from "@/components/ui/card";
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

  const { data, isPending, isError, error, isPlaceholderData } = useOffers({
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
          {t("offers.empty")}
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
