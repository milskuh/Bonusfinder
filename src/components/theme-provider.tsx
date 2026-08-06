"use client";

// Client theme context: holds the chosen colour scheme ("light" | "dark" |
// "system", persisted to localStorage) and reflects it onto <html> via the
// `.dark` class that drives every design token in globals.css. The pre-paint
// script in layout.tsx applies the same choice before first paint so there's no
// flash; this provider keeps it in sync afterwards and powers <ThemeToggle>.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
// Order the toggle cycles through on each click.
const CYCLE: Theme[] = ["light", "dark", "system"];

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const systemPrefersDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Resolve the theme to a boolean and toggle the `.dark` class on <html>. */
function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Defaults to "system"; the persisted choice is read after mount (localStorage
  // isn't available during SSR). The class is already correct via the pre-paint
  // script, so this only settles the toggle's own state — no content flash.
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setThemeState(saved);
    }
  }, []);

  // While following the system, re-apply if the OS scheme flips with the app
  // open. Manual "light"/"dark" deliberately ignore the OS, so no listener then.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Header control that cycles light → dark → system, showing an icon for the
 * current mode. "System" hands control back to the OS colour-scheme setting.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLang();
  const Icon = ICONS[theme];
  const label = t("theme.toggle", { mode: t(`theme.${theme}` as TKey) });
  return (
    <button
      onClick={() => setTheme(CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length])}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
