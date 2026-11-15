"use client";

import { createContext, useContext, type ReactNode } from "react";

import { translate, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  if (locale === null) {
    throw new Error("useLocale must be used within LocaleProvider.");
  }
  return locale;
}

export function useTranslations() {
  const locale = useLocale();
  return (
    key: Parameters<typeof translate>[1],
    params?: Parameters<typeof translate>[2],
  ) => translate(locale, key, params);
}
