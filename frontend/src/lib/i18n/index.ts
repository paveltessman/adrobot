import { messages } from "./messages.ts";

export const localeCookie = "adrobot-locale";
export const defaultLocale = "en";
export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof messages.en;
type Params = Record<string, string | number>;

export function resolveLocale(value: unknown): Locale {
  return value === "ru" || value === "en" ? value : defaultLocale;
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params: Params = {},
): string {
  const message = messages[locale][key];
  let template: string;
  if (typeof message === "string") {
    template = message;
  } else {
    if (typeof params.count !== "number" || !Number.isFinite(params.count)) {
      throw new TypeError(`Translation ${key} requires a finite count.`);
    }
    const category = new Intl.PluralRules(locale).select(params.count);
    template = message[category as keyof typeof message] ?? message.other;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!Object.hasOwn(params, name)) {
      throw new TypeError(`Translation ${key} requires parameter ${name}.`);
    }
    return String(params[name]);
  });
}
