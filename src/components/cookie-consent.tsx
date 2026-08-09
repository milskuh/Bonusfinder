"use client";

// Consent-gated Google Analytics. GA4 sets cookies, so under the AVG/ePrivacy it
// may only load *after* the user opts in. This component keeps the choice in
// localStorage (like the theme/locale) and mounts <GoogleAnalytics> only once
// consent is "granted" — before that no gtag script, cookie, or /collect request
// fires at all. Declining persists so the banner stays dismissed.
import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { useLang } from "@/components/language-provider";

const STORAGE_KEY = "cookie-consent";
type Consent = "granted" | "denied";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

// Event the footer's "Cookie settings" link dispatches to re-open the banner so
// a visitor can change (or withdraw) an earlier choice. Kept as a window event
// to keep <CookieConsent> and the footer decoupled — no shared provider needed.
const REOPEN_EVENT = "cookie-consent:reopen";

/** Clear the saved choice and re-show the consent banner. Call from anywhere. */
export function openCookieSettings() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

export function CookieConsent() {
  const { t } = useLang();
  // `undefined` = not yet read (SSR/first paint); `null` = read, still undecided.
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);

  // Read the saved choice after mount to avoid an SSR/hydration mismatch, and
  // re-show the banner whenever the footer link asks to re-open settings.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    setConsent(saved === "granted" || saved === "denied" ? saved : null);
    const reopen = () => setConsent(null);
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, []);

  const choose = (value: Consent) => {
    window.localStorage.setItem(STORAGE_KEY, value);
    setConsent(value);
  };

  // No Measurement ID configured → nothing to gate; render nothing.
  if (!GA_ID) return null;

  // Consent granted: load GA. (Banner is gone because consent !== null.)
  if (consent === "granted") return <GoogleAnalytics gaId={GA_ID} />;

  // Undecided → show the banner. `undefined` (pre-read) and "denied" render nothing.
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label={t("consent.message")}
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 py-4 shadow-lg backdrop-blur sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <p className="text-sm text-muted-foreground">{t("consent.message")}</p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => choose("denied")}
            className="rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            {t("consent.decline")}
          </button>
          <button
            onClick={() => choose("granted")}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90"
          >
            {t("consent.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
