export const en = {
  metadataTitle: "Adrobot | Campaign management",
  metadataDescription:
    "Create and manage Keitaro advertising campaigns with Adrobot.",
  language: "Language",
  offersCount: {
    one: "{count} offer",
    few: "{count} offers",
    many: "{count} offers",
    other: "{count} offers",
  },
} as const;

type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};

export const ru = {
  metadataTitle: "Adrobot | Управление кампаниями",
  metadataDescription:
    "Создавайте рекламные кампании Keitaro и управляйте ими с помощью Adrobot.",
  language: "Язык",
  offersCount: {
    one: "{count} оффер",
    few: "{count} оффера",
    many: "{count} офферов",
    other: "{count} оффера",
  },
} as const satisfies MessageShape<typeof en>;

export const messages = { en, ru };
