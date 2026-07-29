"use client";

import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { Heart } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/language-provider";
import { useFavorites, useToggleFavorite, type FavoriteItem } from "@/hooks/use-favorites";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

function FavoriteCard({ fav }: { fav: FavoriteItem }) {
  const { t, locale, offerText } = useLang();
  const toggle = useToggleFavorite();
  const best = fav.product.offers[0] ?? null;
  const bestDealText = best ? offerText(best.offerText) : null;
  const productName = (locale === "en" && fav.product.nameEn) || fav.product.name;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex-row items-start justify-between gap-2 px-4">
        <div>
          <h3 className="line-clamp-2 text-sm font-medium">{productName}</h3>
          {fav.product.brand && (
            <p className="text-xs text-muted-foreground">{fav.product.brand}</p>
          )}
        </div>
        <button
          onClick={() => toggle.mutate({ productId: fav.productId, add: false })}
          aria-label={t("fav.remove")}
          title={t("fav.remove")}
          className="grid size-8 shrink-0 place-items-center rounded-full border transition-colors hover:bg-accent"
        >
          <Heart className="size-4 fill-red-500 text-red-500" />
        </button>
      </CardHeader>

      <CardContent className="px-4">
        {best ? (
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">
              {best.salePrice != null
                ? euro.format(Number(best.salePrice))
                : (bestDealText ??
                  (best.discountPercent ? `-${best.discountPercent}%` : t("card.bonus")))}
            </span>
            {best.discountPercent != null && best.discountPercent > 0 ? (
              <Badge variant="destructive">-{best.discountPercent}%</Badge>
            ) : (
              best.salePrice != null && bestDealText && (
                <Badge variant="secondary">{bestDealText}</Badge>
              )
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{t("favorites.none")}</span>
        )}
      </CardContent>

      {best && (
        <CardFooter className="px-4 text-xs text-muted-foreground">
          {t("favorites.cheapest", { market: best.supermarket.name })}
        </CardFooter>
      )}
    </Card>
  );
}

function FavoritesList() {
  const { t } = useLang();
  const { data, isPending, isError, error } = useFavorites();

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  }

  if (data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("favorites.empty")}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.items.map((fav) => (
        <FavoriteCard key={fav.id} fav={fav} />
      ))}
    </div>
  );
}

export default function FavoritesPage() {
  const { t } = useLang();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t("favorites.title")}</h1>

      <SignedOut>
        <div className="rounded-lg border px-4 py-10 text-center">
          <p className="mb-4 text-sm text-muted-foreground">{t("favorites.signedOut")}</p>
          <SignInButton mode="modal">
            <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              {t("auth.login")}
            </button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <FavoritesList />
      </SignedIn>
    </main>
  );
}
