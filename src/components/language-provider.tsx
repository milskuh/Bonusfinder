"use client";

// Client language context: holds the current locale (persisted to
// localStorage), and exposes a bound `t()` plus the raw setter. Wrap the app in
// <LanguageProvider> (done in providers.tsx) and read it with useLang().
import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  formatShortDate,
  t as translate,
  translateOfferText,
  type Locale,
  type TKey,
} from "@/lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TKey, params?: Record<string, string | number>) => string;
  formatDate: (date: Date) => string;
  offerText: (text: string | null) => string | null;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "locale";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Load the persisted choice after mount (avoids SSR/first-paint mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "nl") setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  };

  const value: LanguageContextValue = {
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    formatDate: (date) => formatShortDate(locale, date),
    offerText: (text) => translateOfferText(text, locale),
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within a LanguageProvider");
  return ctx;
}

/** NL/EN toggle button for the header. */
export function LanguageToggle() {
  const { locale, setLocale } = useLang();
  const next = locale === "nl" ? "en" : "nl";
  return (
    <button
      onClick={() => setLocale(next)}
      aria-label={`Switch to ${next === "en" ? "English" : "Nederlands"}`}
      className="rounded-md border px-2 py-1 text-xs font-medium uppercase transition-colors hover:bg-accent"
    >
      {locale === "nl" ? "EN" : "NL"}
    </button>
  );
}
