"use client";

import {
  displayState,
  displaySchema,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n";
import { useTranslations, useLocale } from "@/components/locale-provider";
import { StreamOfferEditor } from "@/components/stream-offer-editor";
import type { StreamDraft } from "@/lib/campaign-draft";
import type { CampaignStream } from "@/lib/campaign-details";

function redirectCountries(stream: CampaignStream, locale: Locale): string {
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const filters = stream.filters.filter((filter) => filter.name === "country");
  if (filters.length === 0) return t("allCountries");
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  return filters
    .map((filter) => {
      const codes = Array.isArray(filter.payload)
        ? filter.payload.filter(
            (value): value is string => typeof value === "string",
          )
        : typeof filter.payload === "string"
          ? [filter.payload]
          : [];
      const countries = codes
        .map((code) => {
          const normalized = code.toUpperCase();
          return /^[A-Z]{2}$/.test(normalized)
            ? `${regions.of(normalized) || normalized} (${normalized})`
            : code;
        })
        .join(", ");
      return filter.mode === "reject"
        ? t("exceptCountries", { countries: countries || t("notSpecified") })
        : countries || t("notSpecified");
    })
    .join("; ");
}

export function CampaignStreamView({
  stream,
  showRemoved,
  draft,
  revision,
  setDraft,
  disabled,
}: {
  stream: CampaignStream;
  showRemoved: boolean;
  draft?: StreamDraft;
  revision: number;
  setDraft: (update: (current: StreamDraft) => StreamDraft) => void;
  disabled: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <section
      aria-labelledby={`stream-${stream.id}`}
      className="rounded-xl border bg-background p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3
          id={`stream-${stream.id}`}
          className="text-lg font-semibold [overflow-wrap:anywhere]"
        >
          {stream.name || t("unnamedStream")}
        </h3>
        <span
          aria-label={t("routing", {
            schema: displaySchema(locale, stream.schema),
          })}
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
        >
          {displaySchema(locale, stream.schema)}
        </span>
        <span
          aria-label={t("status", {
            state: displayState(locale, stream.state),
          })}
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
        >
          {displayState(locale, stream.state)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("streamId", { id: stream.id })}
      </p>
      {stream.schema === "redirect" ? (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{t("countries")}</dt>
            <dd className="[overflow-wrap:anywhere]">
              {redirectCountries(stream, locale)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {t("destination")}
            </dt>
            <dd className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {typeof stream.action_payload === "string"
                ? stream.action_payload || t("notProvided")
                : t("notProvided")}
            </dd>
          </div>
        </dl>
      ) : (
        <>
          <h4 className="mt-4 font-medium">{t("offers")}</h4>
          {draft ? (
            <fieldset disabled={disabled} className="min-w-0">
              <StreamOfferEditor
                key={revision}
                stream={stream}
                showRemoved={showRemoved}
                draft={draft}
                setDraft={setDraft}
              />
            </fieldset>
          ) : stream.offers.length === 0 &&
            (!showRemoved || stream.removed_offers.length === 0) ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("noAttachedOffers")}
            </p>
          ) : (
            <ul
              className="mt-3 divide-y"
              aria-label={t("offersIn", {
                stream: stream.name || t("streamFallback", { id: stream.id }),
              })}
            >
              {stream.offers.map((membership) => {
                const offer = stream.offer_details.find(
                  (item) => item.id === membership.offer_id,
                )!;
                return (
                  <li
                    key={membership.offer_id}
                    className="flex flex-wrap items-start justify-between gap-3 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {offer.name || t("unnamedOffer")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("offerId", { id: offer.id })} · {t("attached")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("membershipOffer", {
                          membership: displayState(locale, membership.state),
                          state: displayState(locale, offer.state),
                        })}
                      </p>
                    </div>
                    <p className="text-sm">
                      {t("trafficShare")}:{" "}
                      <span className="font-semibold">{membership.share}%</span>
                    </p>
                  </li>
                );
              })}
              {showRemoved &&
                stream.removed_offers.map((offer) => (
                  <li
                    key={offer.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/50 px-3 py-4 text-muted-foreground"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {offer.name || t("unnamedOffer")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("offerId", { id: offer.id })} · {t("removed")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("historicalOfferState", {
                          state: displayState(locale, offer.last_known_state),
                        })}{" "}
                        {t("availabilityUnchecked")}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("noTraffic")}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
