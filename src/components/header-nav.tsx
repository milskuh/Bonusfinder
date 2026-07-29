"use client";

// Header navigation. Client component so it can read the language context
// (translated "Favorites" label) and host the NL/EN toggle. Clerk's auth
// controls render fine inside a client component.
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useLang, LanguageToggle } from "@/components/language-provider";

export function HeaderNav() {
  const { t } = useLang();
  return (
    <nav className="flex items-center gap-3">
      <LanguageToggle />
      <SignedIn>
        <a href="/favorites" className="text-sm text-muted-foreground hover:text-foreground">
          {t("nav.favorites")}
        </a>
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal" />
        <SignUpButton mode="modal" />
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </nav>
  );
}
