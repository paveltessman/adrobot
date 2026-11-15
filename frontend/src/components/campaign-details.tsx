"use client";

import { displayState } from "@/lib/i18n";

import Link from "next/link";
import { useTranslations, useLocale } from "@/components/locale-provider";
import { CampaignStreamView } from "@/components/campaign-stream-view";
import { CampaignDraftActions } from "@/components/campaign-draft-actions";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { ArrowLeft, RotateCw } from "lucide-react";
import { useState } from "react";
import { useCampaignEditor } from "@/lib/use-campaign-editor";
import { Button, buttonVariants } from "@/components/ui/button";

export function CampaignDetailsView({ campaignId }: { campaignId: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const [showRemoved, setShowRemoved] = useState(false);
  const {
    state,
    validId,
    busy,
    shouldWarnLeave,
    retry,
    updateDraft,
    cancel,
    push,
    checkSaved,
  } = useCampaignEditor(campaignId);
  const confirmLeave = useDraftNavigation(shouldWarnLeave);

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
          <Button variant="outline" className="mt-5" onClick={retry}>
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
                onClick={() => void checkSaved()}
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
                    <CampaignStreamView
                      key={stream.id}
                      stream={stream}
                      showRemoved={showRemoved}
                      draft={state.drafts[stream.id]}
                      revision={state.revision}
                      disabled={state.sync !== "idle"}
                      setDraft={(update) => updateDraft(stream.id, update)}
                    />
                  ))}
                </div>
              )}
              <CampaignDraftActions
                drafts={state.drafts}
                busy={busy}
                unknown={state.sync === "unknown"}
                onPush={() => void push()}
                onCancel={cancel}
              />
            </section>
          </>
        )
      )}
    </>
  );
}
