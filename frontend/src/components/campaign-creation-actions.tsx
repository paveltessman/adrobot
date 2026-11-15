"use client";

import Link from "next/link";
import { useTranslations } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n";

export type CreationSubmission =
  | { status: "idle"; error?: MessageKey }
  | { status: "submitting" }
  | { status: "created"; campaignId: number }
  | { status: "partial" | "unknown"; campaignId: number | null };

export function CampaignCreationActions({
  submission,
  validation,
  reviewed,
  onReviewedChange,
  onEnableCreation,
  onBeforeNavigate,
  onCancel,
}: {
  submission: CreationSubmission;
  validation: MessageKey | null;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  onEnableCreation: () => void;
  onBeforeNavigate: () => boolean;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const busy = submission.status === "submitting";
  const blocked =
    submission.status === "partial" || submission.status === "unknown";
  const locked = busy || blocked || submission.status === "created";

  return (
    <div
      className="mt-5 border-t pt-5"
      aria-label={t("creationActions")}
      role="region"
    >
      {validation && !locked && (
        <p className="mb-3 text-sm text-muted-foreground">{t(validation)}</p>
      )}
      {submission.status === "idle" && submission.error && (
        <p role="alert" className="mb-3 text-sm">
          {t(submission.error)}
        </p>
      )}
      {busy && (
        <p role="status" className="mb-3 text-sm">
          {t("creatingCampaign")}
        </p>
      )}
      {submission.status === "created" && (
        <p role="status" className="mb-3 text-sm">
          {t("campaignCreated")}
        </p>
      )}
      {blocked && (
        <div className="mb-4 space-y-3 text-sm">
          <p role="alert">
            {submission.status === "partial"
              ? t("creationIncomplete")
              : t("creationUnknown")}{" "}
            {t("creationKept")}
          </p>
          {submission.campaignId && (
            <p>
              {t("keitaroId", { id: submission.campaignId })} ·{" "}
              <Link
                className="font-medium underline"
                href={`/campaigns/${submission.campaignId}`}
                onNavigate={(event) => {
                  if (!onBeforeNavigate()) event.preventDefault();
                }}
              >
                {t("inspectCampaign")}
              </Link>
            </p>
          )}
          <label className="flex items-start gap-2">
            <input
              className="mt-1 accent-emerald-700"
              type="checkbox"
              checked={reviewed}
              onChange={(event) => onReviewedChange(event.target.checked)}
            />
            {t("creationReviewed")}
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!reviewed}
            onClick={onEnableCreation}
          >
            {t("enableCreation")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={locked || !!validation}>
          {t("push")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || submission.status === "created"}
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
