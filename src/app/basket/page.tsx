"use client";

import { useState } from "react";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import {
  ImageOff,
  Minus,
  Plus,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SupermarketLogo } from "@/components/offers/supermarket-logo";
import { useLang } from "@/components/language-provider";
import {
  useBasket,
  useOptimizeBasket,
  useRemoveBasketItem,
  useUpdateBasketQuantity,
  type BasketListItem,
} from "@/hooks/use-basket";
import type { NeedsAttentionItem, OptimizeBasketResult } from "@/lib/queries/basket";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
/** Integer cents → formatted euros (same money handling as the offer card). */
const fmt = (cents: number) => euro.format(cents / 100);

// --- Small building blocks ---------------------------------------------------

function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(!src);
  return (
    <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-contain p-1"
        />
      ) : (
        <div className="grid size-full place-items-center text-neutral-300">
          <ImageOff className="size-5" aria-hidden />
        </div>
      )}
    </div>
  );
}

/** "€1,29 × 3" — unit price, and the multiplier only when quantity > 1. */
function UnitLabel({ unitCents, quantity }: { unitCents: number; quantity: number }) {
  return (
    <span className="tabular-nums">
      {fmt(unitCents)}
      {quantity > 1 ? ` × ${quantity}` : ""}
    </span>
  );
}

// --- Shopping-list rows ------------------------------------------------------

function BasketItemRow({ item }: { item: BasketListItem }) {
  const { t, locale } = useLang();
  const update = useUpdateBasketQuantity();
  const remove = useRemoveBasketItem();
  const name = (locale === "en" && item.product.nameEn) || item.product.name;

  const step = "grid size-7 place-items-center rounded-md transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <li className="flex items-center gap-3 py-3">
      <ProductThumb src={item.product.imageUrl} alt={name} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{name}</p>
        {item.product.brand && (
          <p className="text-xs text-muted-foreground">{item.product.brand}</p>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-lg border p-0.5">
        <button
          onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity - 1 })}
          disabled={item.quantity <= 1}
          aria-label={t("basket.decrease")}
          className={step}
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
        <button
          onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity + 1 })}
          disabled={item.quantity >= 99}
          aria-label={t("basket.increase")}
          className={step}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>

      <button
        onClick={() => remove.mutate(item.productId)}
        aria-label={t("basket.removeFromBasket")}
        title={t("basket.removeFromBasket")}
        className="grid size-9 shrink-0 place-items-center rounded-full border transition-colors hover:bg-accent hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

// --- Optimisation strategies -------------------------------------------------

function SavingsCallout({ savings }: { savings: OptimizeBasketResult["savings"] }) {
  const { t } = useLang();
  // Only ever advertise a positive saving (see basket.ts — amountCents can be ≤ 0
  // when no single store covers the whole basket).
  if (savings.amountCents <= 0 || !savings.mostExpensiveStore) return null;
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 px-5 py-4">
      <p className="text-lg font-bold text-brand">
        {t("basket.savings", { amount: fmt(savings.amountCents) })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("basket.savingsDetail", {
          percent: savings.percent,
          store: savings.mostExpensiveStore.name,
        })}
      </p>
    </div>
  );
}

function MultiStoreCard({ multi }: { multi: OptimizeBasketResult["multiStore"] }) {
  const { t, locale } = useLang();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand" aria-hidden />
          {t("basket.multiStore.title")}
        </CardTitle>
        <CardDescription>
          {t("basket.multiStore.subtitle")} · {t("basket.multiStore.stores", { n: multi.storeCount })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y">
          {multi.lines.map((l) => {
            const name = (locale === "en" && l.product.nameEn) || l.product.name;
            return (
              <li key={l.productId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm">{name}</p>
                  <span className="text-xs text-muted-foreground">
                    <UnitLabel unitCents={l.unitPriceCents} quantity={l.quantity} />
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SupermarketLogo supermarket={l.supermarket} />
                  <span className="w-16 text-right text-sm font-semibold tabular-nums">
                    {fmt(l.lineTotalCents)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-medium">{t("basket.total")}</span>
          <span className="text-lg font-bold tabular-nums">{fmt(multi.totalCents)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SingleStoreCard({ single }: { single: OptimizeBasketResult["singleStore"] }) {
  const { t, locale } = useLang();
  const best = single.best;
  if (!best) return null;
  const partial = best.coverage.covered < best.coverage.total;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="size-4 text-brand" aria-hidden />
          {t("basket.singleStore.title")}
        </CardTitle>
        <CardDescription>{t("basket.singleStore.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SupermarketLogo supermarket={best.supermarket} />
            <Badge variant={partial ? "secondary" : "outline"}>
              {t("basket.coverage", {
                covered: best.coverage.covered,
                total: best.coverage.total,
              })}
            </Badge>
          </div>
          <span className="text-lg font-bold tabular-nums">{fmt(best.totalCents)}</span>
        </div>
        <ul className="divide-y">
          {best.lines.map((l) => {
            const name = (locale === "en" && l.product.nameEn) || l.product.name;
            return (
              <li
                key={l.productId}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="line-clamp-1">{name}</span>
                <span className="shrink-0 text-muted-foreground">
                  <UnitLabel unitCents={l.unitPriceCents} quantity={l.quantity} />
                  {" · "}
                  <span className="font-medium text-foreground">{fmt(l.lineTotalCents)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function NeedsAttentionCard({ items }: { items: NeedsAttentionItem[] }) {
  const { t, locale, offerText } = useLang();
  if (items.length === 0) return null;
  return (
    <Card className="border-amber-300/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-700">
          <TriangleAlert className="size-4" aria-hidden />
          {t("basket.needsAttention")}
        </CardTitle>
        <CardDescription>{t("basket.needsAttentionHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((it) => {
            const name = (locale === "en" && it.product.nameEn) || it.product.name;
            // Price-less promos show their (translated) offerText; truly missing
            // offers show a neutral "no active deal".
            const label =
              it.reason === "no-price"
                ? (offerText(it.offerText) ?? t("basket.noPrice"))
                : t("basket.noOffer");
            return (
              <li key={it.productId} className="flex items-center justify-between gap-3 py-2">
                <span className="line-clamp-1 text-sm">
                  {name}
                  {it.quantity > 1 ? ` × ${it.quantity}` : ""}
                </span>
                <Badge variant="secondary">{label}</Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function OptimizationSection() {
  const { t } = useLang();
  const { data, isPending, isError } = useOptimizeBasket();

  if (isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-sm text-destructive">{t("basket.optimizeError")}</p>;
  }

  return (
    <div className="space-y-4">
      <SavingsCallout savings={data.savings} />
      {data.pricedItemCount > 0 ? (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <MultiStoreCard multi={data.multiStore} />
          <SingleStoreCard single={data.singleStore} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("basket.noPricedItems")}</p>
      )}
      <NeedsAttentionCard items={data.needsAttention} />
    </div>
  );
}

// --- Page --------------------------------------------------------------------

function BasketView() {
  const { t } = useLang();
  const { data, isPending, isError, error } = useBasket();

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  }
  if (data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("basket.empty")}</p>;
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("basket.itemsTitle")}</h2>
          <span className="text-xs text-muted-foreground">
            {t("basket.count", { n: data.items.length })}
          </span>
        </div>
        <ul className="divide-y rounded-xl border bg-card px-4">
          {data.items.map((item) => (
            <BasketItemRow key={item.id} item={item} />
          ))}
        </ul>
      </section>

      <OptimizationSection />
    </div>
  );
}

export default function BasketPage() {
  const { t } = useLang();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold tracking-tight">
        <ShoppingCart className="size-6" aria-hidden />
        {t("basket.title")}
      </h1>

      <SignedOut>
        <div className="rounded-lg border px-4 py-10 text-center">
          <p className="mb-4 text-sm text-muted-foreground">{t("basket.signedOut")}</p>
          <SignInButton mode="modal">
            <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              {t("auth.login")}
            </button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <BasketView />
      </SignedIn>
    </main>
  );
}
