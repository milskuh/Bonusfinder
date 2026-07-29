"use client";

import { Heart } from "lucide-react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/language-provider";
import { useFavoriteIds, useToggleFavorite } from "@/hooks/use-favorites";

const base =
  "grid size-8 place-items-center rounded-full border bg-background/80 backdrop-blur transition-colors hover:bg-accent";

export function FavoriteButton({ productId }: { productId: string }) {
  const { t } = useLang();
  const { isSignedIn } = useAuth();
  const { data: ids } = useFavoriteIds();
  const toggle = useToggleFavorite();

  // Signed out: the heart opens the Clerk sign-in modal instead of mutating.
  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button className={base} aria-label={t("fav.login")} title={t("fav.login")}>
          <Heart className="size-4 text-muted-foreground" />
        </button>
      </SignInButton>
    );
  }

  const isFav = ids?.has(productId) ?? false;

  return (
    <button
      onClick={() => toggle.mutate({ productId, add: !isFav })}
      aria-pressed={isFav}
      aria-label={isFav ? t("fav.remove") : t("fav.add")}
      title={isFav ? t("fav.remove") : t("fav.add")}
      className={base}
    >
      <Heart
        className={cn(
          "size-4 transition-colors",
          isFav ? "fill-red-500 text-red-500" : "text-muted-foreground",
        )}
      />
    </button>
  );
}
