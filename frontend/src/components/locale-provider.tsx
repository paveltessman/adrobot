"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  localeCookie,
  resolveLocale,
  translate,
  type Locale,
} from "@/lib/i18n";

const LocaleContext = createContext<{
  locale: Locale;
  changeLocale: (locale: Locale) => void;
} | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const [selectedLocale, setSelectedLocale] = useState(locale);

  useEffect(() => {
    document.documentElement.lang = selectedLocale;
  }, [selectedLocale]);

  function changeLocale(value: Locale) {
    const nextLocale = resolveLocale(value);
    try {
      document.cookie = `${localeCookie}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      // Keep switching available for this session if cookies are blocked.
    }
    setSelectedLocale(nextLocale);
  }

  return (
    <LocaleContext.Provider value={{ locale: selectedLocale, changeLocale }}>
      {/* React hoists these tags into the head, including during server rendering.
          Keeping one owner lets metadata follow local changes without a reload. */}
      <title>{translate(selectedLocale, "metadataTitle")}</title>
      <meta
        name="description"
        content={translate(selectedLocale, "metadataDescription")}
      />
      {children}
    </LocaleContext.Provider>
  );
}

function useLocaleContext() {
  const context = useContext(LocaleContext);
  if (context === null) {
    throw new Error("Locale hooks must be used within LocaleProvider.");
  }
  return context;
}

export function useLocale() {
  return useLocaleContext().locale;
}

export function useChangeLocale() {
  return useLocaleContext().changeLocale;
}

export function useTranslations() {
  const locale = useLocale();
  return (
    key: Parameters<typeof translate>[1],
    params?: Parameters<typeof translate>[2],
  ) => translate(locale, key, params);
}
