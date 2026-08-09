"use client";

// Site-wide footer. Client component so it can read the language context and
// re-open the cookie consent banner (lets a visitor change or withdraw an
// earlier analytics choice — the compliant counterpart to the opt-in).
import { useLang } from "@/components/language-provider";
import { openCookieSettings } from "@/components/cookie-consent";
import { APP_NAME } from "@/lib/config";

export function SiteFooter() {
  const { t } = useLang();
  return (
    <footer className="mt-12 border-t bg-background px-4 py-6 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
        <p>
          © {new Date().getFullYear()} {APP_NAME} — {t("footer.tagline")}
        </p>
        <button
          onClick={openCookieSettings}
          className="rounded-md px-2.5 py-1.5 font-medium transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("footer.cookieSettings")}
        </button>
      </div>
    </footer>
  );
}
