import { create } from "zustand";
import { en, type Dict, type TKey } from "./en";
import { uz } from "./uz";
import { ru } from "./ru";
import { load, save } from "../storage";

export type Locale = "en" | "uz" | "ru";
export const LOCALES: Array<{ id: Locale; label: string; native: string }> = [
  { id: "en", label: "English", native: "English" },
  { id: "uz", label: "Uzbek", native: "O‘zbekcha" },
  { id: "ru", label: "Russian", native: "Русский" },
];

const DICTS: Record<Locale, Partial<Dict>> = { en, uz, ru };

function detect(): Locale {
  const stored = load<Locale | null>("mfc.locale", null);
  if (stored && stored in DICTS) return stored;
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2);
  return (nav in DICTS ? nav : "en") as Locale;
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: detect(),
  setLocale: (locale) => {
    save("mfc.locale", locale);
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

export function translate(locale: Locale, key: TKey | string, vars?: Record<string, string | number>): string {
  const raw = (DICTS[locale] as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : raw;
}

/** Non-hook translator for code outside components (function titles, toasts). */
export const t = (key: TKey | string, vars?: Record<string, string | number>) => translate(useI18n.getState().locale, key, vars);

/** Hook: re-renders when the locale changes. */
export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key: TKey | string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export function relativeTime(iso: string, locale: Locale): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export type { TKey };
