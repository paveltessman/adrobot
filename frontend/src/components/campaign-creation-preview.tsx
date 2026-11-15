"use client";

import type { ReactNode } from "react";
import { useTranslations } from "@/components/locale-provider";
import {
  parseCountryCodes,
  type CreationDraft,
  type CreationOption,
  type CreationSelectors,
} from "@/lib/campaign-create";

export function CampaignCreationPreview({
  draft,
  selectors,
  children,
}: {
  children: ReactNode;
  draft: CreationDraft;
  selectors?: CreationSelectors;
}) {
  const t = useTranslations();
  function option(options: CreationOption[] | undefined, value: string) {
    const selected = options?.find((item) => String(item.id) === value);
    return selected
      ? `${selected.name || t("unnamed")} (ID: ${selected.id})`
      : t("none");
  }
  return (
    <section
      aria-labelledby="creation-preview"
      className="rounded-xl border bg-background p-6 lg:sticky lg:top-6"
    >
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        {t("preview")}
      </p>
      <h2
        id="creation-preview"
        className="mt-2 text-xl font-semibold [overflow-wrap:anywhere]"
      >
        {draft.name.trim() || t("newCampaign")}
      </h2>
      <dl className="mt-5 space-y-3 text-sm">
        {[
          [t("domain"), option(selectors?.domains, draft.domainId)],
          [t("campaignGroup"), option(selectors?.groups, draft.groupId)],
          [t("trafficSource"), option(selectors?.sources, draft.sourceId)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <ol
        className="mt-6 space-y-4 border-t pt-5 text-sm"
        aria-label={t("plannedStreams")}
      >
        <li>
          <h3 className="font-semibold">{t("countryRedirect")}</h3>
          <p className="mt-2">
            {t("trafficCountries", {
              countries:
                parseCountryCodes(draft.countryCodes).join(", ") ||
                t("selectedCountries"),
            })}
          </p>
          <p className="mt-1 break-all text-muted-foreground">
            https://www.google.com
          </p>
        </li>
        <li>
          <h3 className="font-semibold">{t("offersStream")}</h3>
          <p className="mt-2">
            {t("remainingTraffic", {
              offer: draft.offer?.name || t("selectedOfferPlaceholder"),
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {draft.offer
              ? t("initialOfferShare", { id: draft.offer.id })
              : t("selectOfferTraffic")}
          </p>
        </li>
      </ol>
      <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
        {t("pushToSave")}
      </p>
      {children}
    </section>
  );
}
