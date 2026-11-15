"use client";

import {
  useChangeLocale,
  useLocale,
  useTranslations,
} from "@/components/locale-provider";
import { resolveLocale } from "@/lib/i18n";

export function LanguageSelect() {
  const locale = useLocale();
  const changeLocale = useChangeLocale();
  const t = useTranslations();

  return (
    <div>
      <label htmlFor="workspace-language" className="sr-only">
        {t("language")}
      </label>
      <select
        id="workspace-language"
        value={locale}
        onChange={(event) => changeLocale(resolveLocale(event.target.value))}
        className="h-10 rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="ru" lang="ru">
          Русский
        </option>
      </select>
    </div>
  );
}
