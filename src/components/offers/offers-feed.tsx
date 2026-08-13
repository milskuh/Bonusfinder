"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import { useOffers } from "@/hooks/use-offers";
import { useSupermarkets } from "@/hooks/use-supermarkets";
import type { OfferSort, Timeframe } from "@/lib/validation/filters";
import { categoryLabel, sortCategoriesByLabel } from "@/lib/categories";
import { supermarketBrand } from "@/lib/supermarkets";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";
import { OfferCard } from "./offer-card";
import { TopDealsHero } from "./top-deals-hero";
import { SupermarketLogo } from "./supermarket-logo";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "./offers-feed.module.css";

const SORTS: { value: OfferSort; labelKey: TKey }[] = [
  { value: "newest", labelKey: "sort.newest" },
  { value: "discount", labelKey: "sort.discount" },
  { value: "price", labelKey: "sort.price" },
  { value: "unitPrice", labelKey: "sort.unitPrice" },
];

const TIMEFRAMES: { value: Timeframe; labelKey: TKey }[] = [
  { value: "current", labelKey: "timeframe.current" },
  { value: "upcoming", labelKey: "timeframe.upcoming" },
];

const PAGE_SIZE = 24;

function OfferSkeleton() {
  // Mirrors the compact <OfferCard> geometry (padding + type scale) so the grid
  // doesn't jump when real cards replace the skeletons on first paint.
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
      <Skeleton className="aspect-[4/3] w-full rounded-none sm:aspect-square" />
      <div className="flex flex-col gap-2 p-2 sm:p-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-1 h-6 w-20 sm:h-7 sm:w-24" />
        <div className="mt-1.5 flex items-center justify-between border-t border-border pt-2 sm:mt-2">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      </div>
    </div>
  );
}

export function OffersFeed() {
  const { t, locale } = useLang();
  // Filter chips read alphabetically in whichever language is active.
  const orderedCategories = useMemo(() => sortCategoriesByLabel(locale), [locale]);
  const [sort, setSort] = useState<OfferSort>("newest");
  const [timeframe, setTimeframe] = useState<Timeframe>("current");
  const [categories, setCategories] = useState<string[]>([]);
  const [supermarkets, setSupermarkets] = useState<string[]>([]);
  // Mobile-only: the store chips live behind a collapsible "Winkels" disclosure
  // so they don't add a permanent panel above the fold. Always expanded at lg
  // (the desktop sidebar), where this flag is ignored.
  const [storesOpen, setStoresOpen] = useState(false);
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
    if (sp.get("timeframe") === "upcoming") setTimeframe("upcoming");
    const sortParam = sp.get("sort");
    if (sortParam && SORTS.some((s) => s.value === sortParam)) {
      setSort(sortParam as OfferSort);
    }
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
    // Only 'upcoming' is written; 'current' is the default, so it stays out of the URL.
    sync("timeframe", timeframe === "upcoming" ? "upcoming" : "");
    // Only a non-default sort is written; 'newest' is the default, so it stays out of the URL.
    sync("sort", sort === "newest" ? "" : sort);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query, categories, supermarkets, timeframe, sort]);

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
  }, [query, sort, timeframe, categories, supermarkets]);

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
    timeframe,
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

  // Empty-state copy. For an unfiltered 'next week' view, the deals simply aren't
  // published yet (see Phase 0: e.g. AH reveals them only from Friday), so
  // reassure rather than imply an empty category. A text-search miss gets its own
  // "no results for this search" wording (not "category"); a plain category/store
  // filter miss keeps the generic message.
  const noNarrowing = !query && categories.length === 0 && supermarkets.length === 0;
  // The Top-deals hero rides along while browsing: shown for this week whenever the
  // user isn't running a text search (where a curated strip is noise). It reflects
  // the active store/category filters (see TopDealsHero) and is independent of the
  // grid's sort, so it stays put as filters and sort change rather than vanishing.
  const showHero = timeframe === "current" && !query;
  const emptyMessage =
    timeframe === "upcoming" && noNarrowing
      ? t("offers.emptyUpcoming")
      : query
        ? t("offers.emptySearch")
        : t("offers.empty");

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

  // Scroll-reveal fallback. Where CSS scroll-driven animations are supported
  // (animation-timeline: view()), the stylesheet reveals each panel/card on its
  // own and this effect bails — no JS. Otherwise we drive the same reveal with
  // an IntersectionObserver, marking elements .revealShown as they enter. A
  // MutationObserver re-scans so cards added by infinite scroll (and the store
  // sidebar, which mounts only once data loads) are picked up too. Skipped under
  // prefers-reduced-motion, where the CSS leaves everything in its final state.
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const container = sectionRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const supportsViewTimeline =
      typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    if (supportsViewTimeline) return;

    const all = () =>
      container.querySelectorAll<HTMLElement>(`.${styles.reveal}`);
    // No IntersectionObserver (very old browsers): just show everything, since
    // the fallback CSS has hidden it up front.
    if (!("IntersectionObserver" in window)) {
      all().forEach((el) => el.classList.add(styles.revealShown));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealShown);
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    let raf = 0;
    const scan = () => {
      raf = 0;
      all().forEach((el) => {
        if (!el.classList.contains(styles.revealShown)) io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(scan);
    });
    mo.observe(container, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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

  // The store filter chips, rendered identically in the desktop sidebar and the
  // mobile disclosure below — only their flex container differs (vertical list
  // vs. horizontal scroll row). Duplicate keys across the two lists are fine:
  // each set has its own parent and only one is visible per breakpoint.
  const storeChips = (
    <>
      <button
        onClick={() => setSupermarkets([])}
        aria-pressed={supermarkets.length === 0}
        className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${
          supermarkets.length === 0
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
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
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1 text-sm font-medium whitespace-nowrap transition ${
              active
                ? "shadow-sm"
                : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
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
    </>
  );

  return (
    <section ref={sectionRef} className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-8">
      <header className={`${styles.panel} ${styles.header} ${styles.reveal} mb-4 sm:mb-6`}>
        <div className={styles.headerText}>
          <h1 className={styles.headerTitle}>{t("offers.title")}</h1>
          <p className={styles.headerSubtitle}>{t("offers.subtitle")}</p>
        </div>
        {/* Live count — quiet muted text (green dot + tabular label), reuses the
            real active-offer total; hidden until the first page resolves. */}
        {total !== null && (
          <span className={styles.countPill}>
            <span className={styles.countDot} aria-hidden />
            {t(timeframe === "upcoming" ? "offers.upcomingPill" : "offers.activePill", { n: total })}
          </span>
        )}
      </header>

      {/* Curated first impression: the biggest discounts for the current view.
          Reflects the active store/category filters (so it doesn't vanish while
          browsing) and collapses itself when there aren't enough real deals. */}
      {showHero && <TopDealsHero supermarkets={supermarkets} categories={categories} />}

      <div className="flex flex-col gap-3 sm:gap-6 lg:flex-row lg:gap-8">
        {/* Store filter as a left sidebar panel (multi-select; none selected =
            all). Only stores with active offers appear; each chip carries its
            brand logo + colour, so a newly added store is styled automatically.
            A horizontal wrapping row on mobile, a vertical list on desktop.
            `lg:self-start` keeps the panel hugging its content (not stretched to
            the row's full height) whether or not it sticks. From lg up it's
            pinned via styles.sidebar — but only behind prefers-reduced-motion, so
            reduced-motion users keep it in normal flow. Deliberately NOT sticky
            on mobile, where it stacks above the (also-sticky) filter bar. */}
        {/* Store filter as a left sidebar panel — desktop only (lg+). On mobile
            the same chips live in a collapsible disclosure inside the sticky
            filter bar below, so they don't push the grid down the screen. */}
        {stores.length > 0 && (
          <aside
            className={`${styles.panel} ${styles.sidebar} ${styles.reveal} hidden lg:block lg:w-56 lg:shrink-0 lg:self-start`}
          >
            {/* No visible heading — the brand chips make it self-evidently the
                store filter. The accessible name lives on the group instead. */}
            <div
              role="group"
              aria-label={t("filter.stores")}
              className="flex flex-col items-start gap-2"
            >
              {storeChips}
            </div>
          </aside>
        )}

        {/* Main column: search + sort, category filters, and the results grid. */}
        <div className="min-w-0 flex-1">
          {/* Filter bar panel — sticky so the sort + category controls stay
              reachable while the grid scrolls beneath it. `top-0` because the app
              header (layout.tsx) is a normal-flow element that scrolls away with
              the page; if it's ever made sticky, offset this by its height. The
              document itself is the scroll container (no overflow:auto/hidden on
              any ancestor), so position:sticky resolves against the viewport. The
              panel's own opaque surface covers grid cards scrolling underneath,
              so no frosted backdrop is needed. */}
          <div
            className={`${styles.panel} ${styles.reveal} sticky top-0 z-30 mb-4 flex flex-col gap-2.5 sm:mb-6`}
          >
            {/* Timeframe: this week vs. next week's ad. A primary view switch, so
                it sits above the search/sort row. Same segmented-control styling
                as the desktop sort control for visual consistency. Shares its row
                with the mobile-only store-filter disclosure toggle (right). */}
            <div className="flex items-center justify-between gap-2">
              <div
                role="group"
                aria-label={t("timeframe.label")}
                className="flex self-start rounded-full bg-muted p-1 text-sm"
              >
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setTimeframe(tf.value)}
                    aria-pressed={timeframe === tf.value}
                    className={`inline-flex min-h-10 items-center rounded-full px-4 py-1.5 font-medium whitespace-nowrap transition ${
                      timeframe === tf.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(tf.labelKey)}
                  </button>
                ))}
              </div>

              {/* Mobile store-filter toggle — hidden at lg where the sidebar shows
                  the chips directly. Badge shows the active store count. */}
              {stores.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStoresOpen((o) => !o)}
                  aria-expanded={storesOpen}
                  aria-controls="store-filter-mobile"
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-foreground/40 hover:text-foreground lg:hidden"
                >
                  {t("filter.stores")}
                  {supermarkets.length > 0 && (
                    <span className="grid min-w-5 place-items-center rounded-full bg-foreground px-1 text-xs font-semibold text-background tabular-nums">
                      {supermarkets.length}
                    </span>
                  )}
                  <ChevronDown
                    className={`size-4 transition-transform ${storesOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
              )}
            </div>

            {/* Collapsible store chips (mobile only). Rendered when open as a
                horizontal scroll row; the desktop sidebar carries them at lg+. */}
            {stores.length > 0 && storesOpen && (
              <div
                id="store-filter-mobile"
                role="group"
                aria-label={t("filter.stores")}
                className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden"
              >
                {storeChips}
              </div>
            )}

            {/* Search (debounced, Postgres FTS) + sort as a segmented control. */}
            <div className="flex items-center gap-2 lg:gap-3 lg:justify-between">
              <div className="relative min-w-0 flex-1 lg:max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
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
                  // text-base (16px) on mobile stops iOS Safari auto-zooming on
                  // focus; shrink to text-sm from lg up where the field is compact.
                  className="w-full rounded-xl border border-border bg-card py-2.5 pr-10 pl-11 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-foreground focus:ring-2 focus:ring-foreground lg:text-sm"
                />
                {rawQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label={t("search.clear")}
                    className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* Sort as a native <select> on mobile: a full-height touch target
                  that opens the OS picker, so all four options stay reachable
                  without the segmented control overflowing the narrow row. */}
              <div className="relative max-w-[40%] shrink-0 lg:hidden">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as OfferSort)}
                  aria-label={t("sort.label")}
                  className="w-full appearance-none rounded-xl border border-border bg-card py-2.5 pr-9 pl-3.5 text-base font-medium text-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>

              {/* The same options as a segmented control from lg up, where the
                  row is wide enough to show all four inline. */}
              <div className="hidden rounded-full bg-muted p-1 text-sm lg:flex">
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSort(s.value)}
                    aria-pressed={sort === s.value}
                    className={`rounded-full px-3.5 py-1.5 font-medium whitespace-nowrap transition ${
                      sort === s.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
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
            <div className="relative">
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-x-visible">
                <button
                  onClick={() => setCategories([])}
                  aria-pressed={categories.length === 0}
                  className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                    categories.length === 0
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  {t("filter.all")}
                </button>
                {orderedCategories.map((cat) => {
                  const active = categories.includes(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      aria-pressed={active}
                      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {categoryLabel(cat, locale)}
                    </button>
                  );
                })}
              </div>
              {/* Right-edge fade hinting the chip row scrolls on mobile (gone
                  from lg up, where the chips wrap onto multiple lines instead). */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent lg:hidden"
              />
            </div>
          </div>

          {/* Results panel — holds the loading skeletons, error/empty states, the
              offer grid, and the infinite-scroll footer. */}
          <div className={`${styles.panel} ${styles.reveal}`}>
            {/* Visually-hidden section heading so the outline goes h1 → h2 →
                (card) h3 without skipping a level. */}
            <h2 className="sr-only">{t("offers.results")}</h2>
            {isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
                {(error as Error).message}
              </div>
            ) : !isPending && offers.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                <p>{emptyMessage}</p>
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
                {isPending
                  ? Array.from({ length: 8 }).map((_, i) => <OfferSkeleton key={i} />)
                  : // Each card sits in a reveal wrapper (not the card itself) so
                    // the enter animation's transform can't clash with the card's
                    // own hover-lift transform. h-full keeps cards equal-height.
                    offers.map((offer) => (
                      <div key={offer.id} className={styles.reveal}>
                        <OfferCard offer={offer} />
                      </div>
                    ))}
              </div>
            )}

            {/* Infinite scroll footer: an invisible sentinel drives fetchNextPage,
                a spinner shows while the next page loads, and once everything is
                loaded a subtle end-of-list marker replaces them. */}
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
      </div>
    </section>
  );
}
