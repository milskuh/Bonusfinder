"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/components/language-provider";
import { FavoriteButton } from "./favorite-button";
import type { OfferListItem } from "@/hooks/use-offers";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

/** Small supermarket badge: logo if it loads, otherwise the market's name. */
function MarketMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        onError={() => setBroken(true)}
        className="h-5 w-5 rounded object-contain"
      />
    );
  }
  return <span className="text-xs font-medium text-muted-foreground">{name}</span>;
}

export function OfferCard({ offer }: { offer: OfferListItem }) {
  const { t, locale, formatDate, offerText } = useLang();
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
    <Card className="gap-3 py-4 transition-shadow hover:shadow-md">
      <CardHeader className="flex-row items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <MarketMark name={offer.supermarket.name} logoUrl={offer.supermarket.logoUrl} />
        </div>
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

      <CardContent className="px-4">
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
