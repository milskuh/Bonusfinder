"use client";

import { Heart } from "lucide-react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/language-provider";
import { useFavoriteIds, useToggleFavorite } from "@/hooks/use-favorites";

// Floating white circle that sits over the product image. `hover:text-red-500`
// tints an unfilled heart red on hover (it inherits currentColor).
const base =
  "grid size-9 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm transition hover:scale-105 hover:text-red-500";

export function FavoriteButton({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const { t } = useLang();
  const { isSignedIn } = useAuth();
  const { data: ids } = useFavoriteIds();
  const toggle = useToggleFavorite();

  // Signed out: the heart opens the Clerk sign-in modal instead of mutating.
  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button
          className={cn(base, className)}
          aria-label={t("fav.login")}
          title={t("fav.login")}
        >
          <Heart className="size-[18px]" />
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
      className={cn(base, className)}
    >
      <Heart
        className={cn(
          "size-[18px] transition-colors",
          isFav && "fill-red-500 text-red-500",
        )}
      />
    </button>
  );
}
