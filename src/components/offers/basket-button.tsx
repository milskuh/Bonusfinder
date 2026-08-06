"use client";

import { ShoppingCart } from "lucide-react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/language-provider";
import { useBasketIds, useToggleBasketItem } from "@/hooks/use-basket";

// Sibling to favorite-button.tsx: a floating circle over the product image tile
// (which stays light in both themes, so the white chip is intentional). Neutral
// cart by default; once the item is in the basket the chip fills with the brand
// colour so "added" reads at a glance.
const base = "grid size-10 place-items-center rounded-full border shadow-sm transition hover:scale-105";
const idle = "border-neutral-200 bg-white text-neutral-400 hover:text-brand";

export function BasketButton({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const { t } = useLang();
  const { isSignedIn } = useAuth();
  const { data: ids } = useBasketIds();
  const toggle = useToggleBasketItem();

  // Signed out: the cart opens the Clerk sign-in modal instead of mutating.
  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button
          className={cn(base, idle, className)}
          aria-label={t("basket.addLogin")}
          title={t("basket.addLogin")}
        >
          <ShoppingCart className="size-[18px]" />
        </button>
      </SignInButton>
    );
  }

  const inBasket = ids?.has(productId) ?? false;

  return (
    <button
      onClick={() => toggle.mutate({ productId, add: !inBasket })}
      aria-pressed={inBasket}
      aria-label={inBasket ? t("basket.removeFromBasket") : t("basket.add")}
      title={inBasket ? t("basket.removeFromBasket") : t("basket.add")}
      className={cn(base, inBasket ? "border-brand bg-brand text-white" : idle, className)}
    >
      <ShoppingCart className="size-[18px]" />
    </button>
  );
}
