"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/language-provider";
import { supermarketBrand, type SupermarketBrand } from "@/lib/supermarkets";
import { FavoriteButton } from "./favorite-button";
import type { OfferListItem } from "@/hooks/use-offers";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

/**
 * Brand-coloured store chip: a pill in the store's colour holding its logo (on a
 * white tile so a coloured logo stays visible) and name. Falls back to the
 * brand badge / first initial when the logo is missing or fails to load.
 */
function StoreChip({
  name,
  logoUrl,
  brand,
}: {
  name: string;
  logoUrl: string | null;
  brand: SupermarketBrand;
}) {
  const [broken, setBroken] = useState(false);
  const showLogo = logoUrl && !broken;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs font-semibold"
      style={{ backgroundColor: brand.color, color: brand.foreground }}
    >
      <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white">
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            onError={() => setBroken(true)}
            className="h-4 w-4 object-contain"
          />
        ) : (
          <span className="text-[10px] font-bold" style={{ color: brand.color }}>
            {brand.badge || name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {name}
    </span>
  );
}

/**
 * Product photo in a fixed 4:3 box so cards stay uniform regardless of the
 * source image's dimensions. Shows a skeleton while loading and a neutral icon
 * placeholder when the image is missing or fails to load — so a null imageUrl
 * or a dead remote URL never breaks the layout.
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
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
      {src && status !== "error" && (
        // Plain lazy <img>: product/logo image hosts vary per source (and can
        // change), so we skip a next/image remote-host allowlist and lean on
        // onError for a clean fallback instead.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`h-full w-full object-contain transition-opacity duration-200 ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {status === "loading" && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-lg" />
      )}
      {status === "error" && (
        <div
          role="img"
          aria-label={emptyLabel}
          className="absolute inset-0 flex items-center justify-center text-muted-foreground"
        >
          <ImageOff className="h-8 w-8" aria-hidden />
        </div>
      )}
    </div>
  );
}

export function OfferCard({ offer }: { offer: OfferListItem }) {
  const { t, locale, formatDate, offerText } = useLang();
  const brand = supermarketBrand(offer.supermarket.slug);
  const sale = offer.salePrice != null ? euro.format(Number(offer.salePrice)) : null;
  const original = offer.originalPrice ? euro.format(Number(offer.originalPrice)) : null;
  const discount = offer.discountPercent ?? 0;
  const dealText = offerText(offer.offerText);
  // Prefer the English product name when the site is in English and a
  // translation exists; otherwise fall back to the original Dutch name.
  const productName =
    (locale === "en" && offer.product.nameEn) || offer.product.name;
  const unit =
    offer.pricePerUnit && offer.pricePerUnitOf
      ? `${euro.format(Number(offer.pricePerUnit))} / ${offer.pricePerUnitOf}`
      : null;

  return (
    <Card
      className="gap-3 border-l-4 py-4 transition-shadow hover:shadow-md"
      style={{ borderLeftColor: brand.color }}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 px-4">
        <StoreChip
          name={offer.supermarket.name}
          logoUrl={offer.supermarket.logoUrl}
          brand={brand}
        />
        <div className="flex items-center gap-1.5">
          {offer.isBestDeal && <Badge>{t("card.bestDeal")}</Badge>}
          {discount > 0 ? (
            <Badge variant="destructive">-{discount}%</Badge>
          ) : (
            dealText && <Badge variant="secondary">{dealText}</Badge>
          )}
          <FavoriteButton productId={offer.product.id} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4">
        <ProductImage
          src={offer.product.imageUrl}
          alt={productName}
          emptyLabel={t("card.noImage")}
        />
        <div>
          {offer.product.url ? (
            <a
              href={offer.product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 text-sm font-medium hover:underline"
            >
              {productName}
            </a>
          ) : (
            <h3 className="line-clamp-2 text-sm font-medium">{productName}</h3>
          )}
          {offer.product.brand && (
            <p className="text-xs text-muted-foreground">{offer.product.brand}</p>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex-col items-start gap-0.5 px-4">
        <div className="flex items-baseline gap-2">
          {sale ? (
            <>
              <span className="text-lg font-semibold">{sale}</span>
              {original && (
                <span className="text-sm text-muted-foreground line-through">{original}</span>
              )}
            </>
          ) : (
            // No single price (e.g. "25% korting", "1+1 gratis") — lead with the deal.
            <span className="text-lg font-semibold">
              {dealText ?? (discount > 0 ? `-${discount}%` : t("card.bonus"))}
            </span>
          )}
        </div>
        {sale && unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        <span className="mt-1 text-xs text-muted-foreground">
          {t("card.validUntil", { date: formatDate(new Date(offer.validUntil)) })}
        </span>
      </CardFooter>
    </Card>
  );
}
