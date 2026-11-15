"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/components/locale-provider";
import { hasChanges, type StreamDraft } from "@/lib/campaign-draft";
import { draftPushError } from "@/lib/campaign-push";

export function CampaignDraftActions({
  drafts,
  onCancel,
  onPush,
  busy,
  unknown,
}: {
  drafts: Record<number, StreamDraft>;
  onCancel: () => void;
  onPush: () => void;
  busy: boolean;
  unknown: boolean;
}) {
  const t = useTranslations();
  const changed = Object.values(drafts).filter(hasChanges);
  if (changed.length === 0) return null;
  const errors = changed.flatMap((draft) => {
    const error = draftPushError(draft);
    return error ? [{ streamId: draft.streamId, message: error }] : [];
  });
  return (
    <div className="mt-5">
      {errors.map((error) => (
        <p
          key={error.streamId}
          role="alert"
          className="mb-3 text-sm text-destructive"
        >
          {t("cannotPushStream", {
            id: error.streamId,
            error: t(error.message),
          })}
        </p>
      ))}
      <div className="flex gap-2">
        <Button
          onClick={onPush}
          disabled={busy || unknown || errors.length > 0}
        >
          {busy ? t("saving") : t("push")}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy || unknown}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
