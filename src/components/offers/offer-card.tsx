"use client";

import { useState } from "react";
import { Calendar, ImageOff, Star, Tag, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/language-provider";
import { SupermarketLogo } from "./supermarket-logo";
import { FavoriteButton } from "./favorite-button";
import { BasketButton } from "./basket-button";
import type { OfferListItem } from "@/hooks/use-offers";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

/** Split a price into whole + ",cc" cents for the raised-cents shelf label. */
function splitEuro(value: number): { whole: string; cents: string } {
  const [whole, cents] = value.toFixed(2).split(".");
  return { whole, cents: "," + cents };
}

/**
 * Product photo filling the square image panel (absolute inset), alongside the
 * card's overlays. object-contain so nothing crops; a skeleton while it loads
 * and a neutral icon when the image is missing or the URL is dead — so a null or
 * broken imageUrl never breaks the layout.
 */
function ProductImage({
  src,
  alt,
  emptyLabel,
}: {
  src: string | null;
  alt: string;
  emptyLabel: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error",
  );

  return (
    <>
      {src && status !== "error" && (
        // Plain lazy <img>: product image hosts vary per source (and can change),
        // so we skip a next/image allowlist and lean on onError for a clean
        // fallback instead.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`absolute inset-0 h-full w-full object-contain p-6 transition-[transform,opacity] duration-500 ease-out group-hover:scale-105 ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {status === "loading" && <Skeleton className="absolute inset-0 h-full w-full" />}
      {status === "error" && (
        <div
          role="img"
          aria-label={emptyLabel}
          className="absolute inset-0 grid place-items-center text-neutral-300"
        >
          <ImageOff className="h-10 w-10" aria-hidden />
        </div>
      )}
    </>
  );
}

/**
 * Price as a shelf label: small €, large whole number, small raised cents. With
 * no sale price (e.g. "1+1 gratis", "25% korting") the deal text leads instead.
 * A struck-through original sits beside the sale price when one is present.
 */
function PriceTag({
  sale,
  original,
  lead,
}: {
  sale: number | null;
  original: number | null;
  lead: string;
}) {
  if (sale == null) {
    return <div className="text-xl font-bold tracking-tight text-card-foreground">{lead}</div>;
  }
  const { whole, cents } = splitEuro(sale);
  return (
    <div className="flex items-baseline gap-2">
      <div className="flex items-start tracking-tight tabular-nums text-card-foreground">
        <span className="mt-0.5 text-base font-semibold">€</span>
        <span className="text-3xl leading-none font-extrabold">{whole}</span>
        <span className="mt-0.5 text-lg font-bold">{cents}</span>
      </div>
      {original != null && (
        <span className="text-sm text-muted-foreground line-through tabular-nums">
          {euro.format(original)}
        </span>
      )}
    </div>
  );
}

export function OfferCard({ offer }: { offer: OfferListItem }) {
  const { t, locale, formatDate, offerText } = useLang();

  const sale = offer.salePrice != null ? Number(offer.salePrice) : null;
  const original = offer.originalPrice != null ? Number(offer.originalPrice) : null;
  const discount = offer.discountPercent ?? 0;
  // For a not-yet-started (next-week) offer the end date alone is ambiguous, so
  // show the full "from t/m until" window; a running offer keeps the compact
  // "t/m until" (its start is already in the past).
  const validFrom = new Date(offer.validFrom);
  const validUntil = new Date(offer.validUntil);
  const isUpcoming = validFrom.getTime() > Date.now();
  const dealText = offerText(offer.offerText);
  // Prefer the English product name when the site is in English and a
  // translation exists; otherwise fall back to the original Dutch name.
  const productName =
    (locale === "en" && offer.product.nameEn) || offer.product.name;
  const unit =
    offer.pricePerUnit && offer.pricePerUnitOf
      ? `${euro.format(Number(offer.pricePerUnit))} / ${offer.pricePerUnitOf}`
      : null;
  // No single sale price → the price area leads with the deal text ("1+1
  // gratis"), else the discount, else a neutral "Bonus".
  const priceLead = dealText ?? (discount > 0 ? `-${discount}%` : t("card.bonus"));

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-neutral-50 to-neutral-100">
        <ProductImage
          src={offer.product.imageUrl}
          alt={productName}
          emptyLabel={t("card.noImage")}
        />

        <div className="absolute top-3 left-3">
          <SupermarketLogo supermarket={offer.supermarket} />
        </div>
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <FavoriteButton productId={offer.product.id} />
          <BasketButton productId={offer.product.id} />
        </div>

        <div className="absolute bottom-3 left-3">
          {discount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-sm font-bold tabular-nums text-white shadow-md">
              <TrendingDown className="size-3.5" strokeWidth={2.5} aria-hidden />
              {`-${discount}%`}
            </span>
          ) : (
            dealText && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-sm font-semibold text-white shadow-md">
                <Tag className="size-3.5" strokeWidth={2.5} aria-hidden />
                {dealText}
              </span>
            )
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {offer.isBestDeal && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            <Star className="size-3 fill-amber-500 text-amber-500" aria-hidden />
            {t("card.bestDeal")}
          </span>
        )}

        {offer.product.url ? (
          <a
            href={offer.product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 min-h-10 text-sm leading-snug font-medium text-card-foreground hover:underline"
          >
            {productName}
          </a>
        ) : (
          <h3 className="line-clamp-2 min-h-10 text-sm leading-snug font-medium text-card-foreground">
            {productName}
          </h3>
        )}

        <div className="mt-auto pt-1">
          <PriceTag sale={sale} original={original} lead={priceLead} />
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-border pt-2.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{unit ?? " "}</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Calendar className="size-3 shrink-0" aria-hidden />
            {isUpcoming
              ? t("card.validRange", {
                  from: formatDate(validFrom),
                  until: formatDate(validUntil),
                })
              : t("card.validUntilShort", { date: formatDate(validUntil) })}
          </span>
        </div>
      </div>
    </div>
  );
}
