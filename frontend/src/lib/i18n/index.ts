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

export function displayState(locale: Locale, state: string): string {
  switch (state) {
    case "active":
      return translate(locale, "stateActive");
    case "disabled":
      return translate(locale, "stateDisabled");
    case "archived":
      return translate(locale, "stateArchived");
    case "deleted":
      return translate(locale, "stateDeleted");
    default:
      return state;
  }
}

export function displaySchema(locale: Locale, schema: string): string {
  switch (schema) {
    case "redirect":
      return translate(locale, "schemaRedirect");
    case "landings":
      return translate(locale, "schemaLandings");
    default:
      return schema;
  }
}
