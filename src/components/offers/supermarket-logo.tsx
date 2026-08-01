"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Stores whose wordmark is unreadable on a white chip get a dark chip instead.
// Currently none: each store's logo reads fine on the white chip (Jumbo's logo
// carries its own yellow background).
const NEEDS_DARK_CHIP = new Set<string>();

type Supermarket = { slug: string; name: string; logoUrl: string | null };

/**
 * A store's identity as a floating pill: its logo on a white (or, for
 * light-on-light wordmarks, near-black) rounded chip. Falls back to the store
 * name as text when there's no logo URL or the image fails to load, so the chip
 * is never empty or broken.
 */
export function SupermarketLogo({
  supermarket,
  className,
}: {
  supermarket: Supermarket;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const dark = NEEDS_DARK_CHIP.has(supermarket.slug);
  const chip = cn(
    "inline-flex items-center rounded-full shadow-sm ring-1",
    dark ? "bg-neutral-900 ring-neutral-800" : "bg-white ring-neutral-200",
    className,
  );

  if (!supermarket.logoUrl || broken) {
    return (
      <span className={cn(chip, "px-2.5 py-1")}>
        <span
          className={cn(
            "text-xs font-semibold",
            dark ? "text-white" : "text-neutral-700",
          )}
        >
          {supermarket.name}
        </span>
      </span>
    );
  }

  return (
    <span className={cn(chip, "px-2 py-1")}>
      {/* Plain <img>: logos are static local assets, so next/image's remote
          allowlist and optimisation buy nothing here; onError covers a missing
          file cleanly. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={supermarket.logoUrl}
        alt={supermarket.name}
        onError={() => setBroken(true)}
        className="h-4 w-auto object-contain"
      />
    </span>
  );
}
