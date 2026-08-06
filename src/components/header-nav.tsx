"use client";

// Header navigation. Client component so it can read the language context
// (translated "Favorites" label) and host the NL/EN toggle. Clerk's auth
// controls render fine inside a client component.
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useLang, LanguageToggle } from "@/components/language-provider";
import { ThemeToggle } from "@/components/theme-provider";

export function HeaderNav() {
  const { t } = useLang();
  return (
    <nav className="flex items-center gap-1.5 sm:gap-3">
      <ThemeToggle />
      <LanguageToggle />
      <SignedIn>
        <a
          href="/favorites"
          className="inline-flex items-center rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("nav.favorites")}
        </a>
        <a
          href="/basket"
          className="inline-flex items-center rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("nav.basket")}
        </a>
      </SignedIn>
      {/* Clerk's default buttons render as bare ~24px text links; passing our own
          child gives them a proper padded tap target (and a brand CTA for sign-up). */}
      <SignedOut>
        <SignInButton mode="modal">
          <button className="rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3">
            {t("auth.login")}
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="rounded-md bg-brand px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 sm:px-3">
            {t("auth.signup")}
          </button>
        </SignUpButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </nav>
  );
}
