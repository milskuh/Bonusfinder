"use client";

// "Top deals deze week" — a curated strip above the main grid that opens the
// unfiltered feed on the biggest discounts, drawn from two worlds only: fresh
// (Vers) and drinks (Dranken, excl. alcohol). It fetches each world's
// discount-sorted slice separately and *interleaves* them, so both are always
// represented rather than one steep-discount category crowding the other out.
// A horizontal scroll row with real overflow + arrow controls (desktop) and
// touch/scroll-snap (mobile) makes it a proper carousel, not more grid.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { useOffers, type OfferListItem } from "@/hooks/use-offers";
import { useLang } from "@/components/language-provider";
import { HERO_FRESH, HERO_DRINKS } from "@/lib/categories";
import { Skeleton } from "@/components/ui/skeleton";
import { OfferCard } from "./offer-card";
import styles from "./offers-feed.module.css";

// Category enum values are plain strings on the wire; the offers filter validates
// them against the same enum server-side.
const FRESH = HERO_FRESH as unknown as string[];
const DRINKS = HERO_DRINKS as unknown as string[];
const MAX = 12;

/** Interleave two discount-sorted lists (fresh, drinks, fresh, drinks, …),
 *  de-duplicating by id and capping at `max`, so both worlds get a fair turn. */
function interleave(a: OfferListItem[], b: OfferListItem[], max: number): OfferListItem[] {
  const out: OfferListItem[] = [];
  const seen = new Set<string>();
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < max; i++) {
    for (const list of [a, b]) {
      const o = list[i];
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

function HeroSkeleton() {
  return (
    <div className="w-36 shrink-0 snap-start sm:w-44">
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <Skeleton className="aspect-[3/2] w-full rounded-none" />
        <div className="flex flex-col gap-2 p-2 sm:p-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
    </div>
  );
}

export function TopDealsHero({
  supermarkets = [],
  categories = [],
}: {
  supermarkets?: string[];
  categories?: string[];
}) {
  const { t } = useLang();
  const withDiscount = (o: OfferListItem) => (o.discountPercent ?? 0) > 0;

  // The hero reflects the active filters so it never disappears mid-browse. With
  // no category filter it keeps the default Vers + Dranken interleave; once the
  // user picks categories it shows the biggest discounts within those instead.
  // Either way an active supermarket filter is applied. Only the live branch's
  // queries fetch (the other is disabled), so this stays cheap.
  const usingCategoryFilter = categories.length > 0;

  const fresh = useOffers(
    { sort: "discount", timeframe: "current", categories: FRESH, supermarkets, discountMin: 10, pageSize: 10 },
    { enabled: !usingCategoryFilter },
  );
  const drinks = useOffers(
    { sort: "discount", timeframe: "current", categories: DRINKS, supermarkets, discountMin: 10, pageSize: 10 },
    { enabled: !usingCategoryFilter },
  );
  const filtered = useOffers(
    { sort: "discount", timeframe: "current", categories, supermarkets, discountMin: 5, pageSize: MAX },
    { enabled: usingCategoryFilter },
  );

  const isPending = usingCategoryFilter
    ? filtered.isPending
    : fresh.isPending || drinks.isPending;
  const items = usingCategoryFilter
    ? (filtered.data?.pages[0]?.items ?? []).filter(withDiscount).slice(0, MAX)
    : interleave(
        (fresh.data?.pages[0]?.items ?? []).filter(withDiscount),
        (drinks.data?.pages[0]?.items ?? []).filter(withDiscount),
        MAX,
      );

  // Track scroll position so the arrows disable at each end (and hide entirely
  // when the row doesn't overflow — nothing to page through).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges({ atStart, atEnd });
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, items.length]);

  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Page by ~80% of the visible width so a card or two always stays for context.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // Don't spend the space on a weak hero: once loaded, a handful of real
  // discounts is the bar. (Fresh + drinks discounts are plentiful, so this
  // rarely hides.)
  if (!isPending && items.length < 3) return null;

  const hasOverflow = !(edges.atStart && edges.atEnd);

  return (
    <section
      aria-labelledby="top-deals-heading"
      className={`${styles.panel} ${styles.reveal} mb-3 sm:mb-5`}
    >
      <div className="mb-2 flex items-center gap-2 sm:mb-3">
        <Flame className="size-4 shrink-0 text-brand" aria-hidden />
        <h2
          id="top-deals-heading"
          className="text-base font-bold tracking-tight sm:text-lg"
        >
          {t("hero.title")}
        </h2>
        <p className="hidden text-sm text-muted-foreground sm:block">{t("hero.subtitle")}</p>

        {/* Desktop arrow controls — hidden on touch, where the row scrolls by
            finger. Pushed to the right of the header row. */}
        {!isPending && hasOverflow && (
          <div className="ml-auto hidden items-center gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => page(-1)}
              disabled={edges.atStart}
              aria-label={t("hero.prev")}
              className="grid size-9 place-items-center rounded-full border border-border bg-card text-foreground transition hover:border-foreground/40 disabled:cursor-default disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => page(1)}
              disabled={edges.atEnd}
              aria-label={t("hero.next")}
              className="grid size-9 place-items-center rounded-full border border-border bg-card text-foreground transition hover:border-foreground/40 disabled:cursor-default disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        // Proximity (not mandatory) snap: still snaps to a card at rest, but a
        // mandatory snap yanks the arrows' smooth programmatic scroll back to the
        // first snap point, so the carousel wouldn't page. See page().
        className="flex snap-x snap-proximity gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isPending
          ? Array.from({ length: 6 }).map((_, i) => <HeroSkeleton key={i} />)
          : items.map((offer) => (
              <div key={offer.id} className="w-36 shrink-0 snap-start sm:w-44">
                <OfferCard offer={offer} hideBestBadge compact />
              </div>
            ))}
      </div>
    </section>
  );
}
