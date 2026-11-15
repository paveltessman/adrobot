"use client";

import {
  displayState,
  displaySchema,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n";

import Link from "next/link";
import { useTranslations, useLocale } from "@/components/locale-provider";
import { StreamOfferEditor } from "@/components/stream-offer-editor";
import { CampaignDraftActions } from "@/components/campaign-draft-actions";
import { hasChanges, type StreamDraft } from "@/lib/campaign-draft";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { ArrowLeft, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  confirmedDrafts,
  proposedChanges,
  pushCampaign,
  PushRejectedError,
  reconcileDrafts,
} from "@/lib/campaign-push";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  CampaignNotFoundError,
  getCampaignDetails,
  type CampaignDetails,
  type CampaignStream,
} from "@/lib/campaign-details";

type LoadState =
  | { status: "loading" }
  | { status: "error" | "missing" }
  | {
      status: "ready";
      campaign: CampaignDetails;
      drafts: Record<number, StreamDraft>;
      revision: number;
      sync: "idle" | "pushing" | "checking" | "unknown";
      feedback: { kind: "success" | "error"; message: MessageKey } | null;
    };

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

function StreamView({
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

export function CampaignDetailsView({ campaignId }: { campaignId: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const validId = Number.isSafeInteger(campaignId) && campaignId > 0;
  const [attempt, setAttempt] = useState(0);
  const [showRemoved, setShowRemoved] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const operation = useRef(false);
  const epoch = useRef(0);
  const busy =
    state.status === "ready" && ["pushing", "checking"].includes(state.sync);
  const dirty =
    state.status === "ready" && Object.values(state.drafts).some(hasChanges);
  const confirmLeave = useDraftNavigation(
    dirty || busy || (state.status === "ready" && state.sync === "unknown"),
  );
  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    getCampaignDetails(campaignId, controller.signal).then(
      (campaign) => {
        if (!controller.signal.aborted)
          setState({
            status: "ready",
            campaign,
            revision: 0,
            drafts: confirmedDrafts(campaign),
            sync: "idle",
            feedback: null,
          });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({
            status:
              error instanceof CampaignNotFoundError ? "missing" : "error",
          });
      },
    );
    return () => {
      controller.abort();
      epoch.current += 1;
      operation.current = false;
    };
  }, [campaignId, validId, attempt]);

  async function synchronize(checkOnly = false) {
    if (state.status !== "ready" || operation.current) return;
    if (!checkOnly && state.sync === "unknown") return;
    let changes;
    try {
      changes = proposedChanges(state.drafts);
    } catch {
      return;
    }
    if (!changes.length && !checkOnly) return;
    const snapshot = state;
    const started = epoch.current;
    operation.current = true;
    setState({
      ...state,
      revision: state.revision + 1,
      sync: checkOnly ? "checking" : "pushing",
      feedback: null,
    });
    try {
      const result = checkOnly
        ? {
            status: "checked" as const,
            campaign: await getCampaignDetails(campaignId),
            pending_streams: changes,
          }
        : await pushCampaign(campaignId, changes);
      const campaign = result.campaign;
      if (started !== epoch.current) return;
      if (!campaign) {
        setState((current) =>
          current.status !== "ready"
            ? current
            : {
                ...current,
                sync: "unknown",
                feedback: {
                  kind: "error",
                  message: "pushUnknown",
                },
              },
        );
        return;
      }
      const pendingIds = result.pending_streams.map(
        (change) => change.stream_id,
      );
      const drafts = reconcileDrafts(campaign, snapshot.drafts, pendingIds);
      const remaining = Object.values(drafts).some(hasChanges);
      setState({
        status: "ready",
        campaign,
        drafts,
        revision: snapshot.revision + 2,
        sync: "idle",
        feedback:
          result.status === "checked"
            ? {
                kind: remaining ? "error" : "success",
                message: remaining ? "checkedRemaining" : "checkedNoPending",
              }
            : result.status === "applied"
              ? { kind: "success", message: "savedSuccessfully" }
              : {
                  kind: "error",
                  message:
                    result.status === "partial" ? "savedPartially" : "notSaved",
                },
      });
    } catch (error) {
      if (started !== epoch.current) return;
      const rejected = !checkOnly && error instanceof PushRejectedError;
      setState((current) =>
        current.status !== "ready"
          ? current
          : {
              ...current,
              sync: rejected ? "idle" : "unknown",
              feedback: {
                kind: "error",
                message: rejected
                  ? error.key
                  : checkOnly
                    ? "checkFailed"
                    : "pushUnconfirmed",
              },
            },
      );
    } finally {
      if (started === epoch.current) operation.current = false;
    }
  }

  return (
    <>
      <Link
        href="/"
        className={buttonVariants({ variant: "outline" })}
        onNavigate={(event) => {
          if (!confirmLeave()) event.preventDefault();
        }}
      >
        <ArrowLeft aria-hidden="true" /> {t("backCampaigns")}
      </Link>
      {!validId || state.status === "missing" ? (
        <div role="alert" className="mt-8">
          <h1 className="text-3xl font-semibold">{t("campaignNotFound")}</h1>
          <p className="mt-3 text-muted-foreground">
            {t("campaignUnavailable")}
          </p>
        </div>
      ) : state.status === "loading" ? (
        <div role="status" className="py-16 text-center text-muted-foreground">
          {t("loadingCampaign")}
        </div>
      ) : state.status === "error" ? (
        <div className="py-16 text-center">
          <div role="alert">
            <h1 className="text-xl font-semibold">{t("campaignLoadFailed")}</h1>
            <p className="mt-3 text-muted-foreground">{t("tryAgain")}</p>
          </div>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            <RotateCw aria-hidden="true" /> {t("retry")}
          </Button>
        </div>
      ) : (
        state.status === "ready" && (
          <>
            <div className="mt-8">
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                  {state.campaign.name || t("unnamedCampaign")}
                </h1>
                {state.campaign.state && (
                  <span
                    aria-label={t("status", {
                      state: displayState(locale, state.campaign.state),
                    })}
                    className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                  >
                    {displayState(locale, state.campaign.state)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <p>{t("keitaroId", { id: state.campaign.id })}</p>
                <p>
                  {t("lastUpdated", {
                    value: state.campaign.updated_at || t("notProvided"),
                  })}
                </p>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("detailsIntro")}
              </p>
            </div>
            {state.feedback && (
              <p
                role={state.feedback.kind === "error" ? "alert" : "status"}
                aria-label={t("synchronization")}
                className="mt-5 text-sm"
              >
                {t(state.feedback.message)}
              </p>
            )}
            {state.sync === "unknown" && (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => void synchronize(true)}
              >
                {t("checkSaved")}
              </Button>
            )}
            {busy && (
              <p role="status" className="mt-5 text-sm">
                {state.sync === "checking"
                  ? t("checkingSaved")
                  : t("savingChanges")}
              </p>
            )}
            <section aria-labelledby="streams-title" className="mt-10">
              <h2 id="streams-title" className="text-2xl font-semibold">
                {t("streams")}
              </h2>
              <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showRemoved}
                  onChange={(event) => setShowRemoved(event.target.checked)}
                  className="size-4 accent-emerald-700"
                />
                {t("showRemoved")}
              </label>
              {state.campaign.streams.length === 0 ? (
                <p className="mt-4 text-muted-foreground">{t("noStreams")}</p>
              ) : (
                <div className="mt-5 space-y-5">
                  {state.campaign.streams.map((stream) => (
                    <StreamView
                      key={stream.id}
                      stream={stream}
                      showRemoved={showRemoved}
                      draft={state.drafts[stream.id]}
                      revision={state.revision}
                      disabled={state.sync !== "idle"}
                      setDraft={(update) =>
                        setState((current) => {
                          // Ignore lookups belonging to a draft canceled in the meantime.
                          if (
                            current.status !== "ready" ||
                            current.revision !== state.revision ||
                            current.sync !== "idle" ||
                            !current.drafts[stream.id]
                          )
                            return current;
                          return {
                            ...current,
                            drafts: {
                              ...current.drafts,
                              [stream.id]: update(current.drafts[stream.id]),
                            },
                          };
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <CampaignDraftActions
                drafts={state.drafts}
                busy={busy}
                unknown={state.sync === "unknown"}
                onPush={() => void synchronize()}
                onCancel={() =>
                  setState((current) =>
                    current.status !== "ready" || current.sync !== "idle"
                      ? current
                      : {
                          ...current,
                          revision: current.revision + 1,
                          drafts: confirmedDrafts(current.campaign),
                          feedback: null,
                        },
                  )
                }
              />
            </section>
          </>
        )
      )}
    </>
  );
}
