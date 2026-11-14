import { Button } from "@/components/ui/button";
import {
  hasChanges,
  offerChanges,
  type StreamDraft,
} from "@/lib/campaign-draft";
import type { CampaignStream } from "@/lib/campaign-details";
import { draftPushError } from "@/lib/campaign-push";

export function CampaignDraftSummary({
  streams,
  drafts,
  onCancel,
  onPush,
  busy,
  unknown,
}: {
  streams: CampaignStream[];
  drafts: Record<number, StreamDraft>;
  onCancel: () => void;
  onPush: () => void;
  busy: boolean;
  unknown: boolean;
}) {
  const changed = Object.values(drafts).filter(hasChanges);
  if (changed.length === 0) return null;
  return (
    <aside
      aria-labelledby="draft-summary-title"
      className="sticky bottom-4 z-10 mt-8 rounded-xl border bg-background p-4 shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="draft-summary-title" className="text-lg font-semibold">
          Pending changes
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={busy || unknown}
          >
            Cancel
          </Button>
          <Button
            onClick={onPush}
            disabled={
              busy ||
              unknown ||
              changed.some((draft) => draftPushError(draft) !== null)
            }
          >
            {busy ? "Saving…" : "Push"}
          </Button>
        </div>
      </div>
      <details className="mt-3" open>
        <summary className="cursor-pointer text-sm font-medium">
          Change summary
        </summary>
        <div className="mt-3 max-h-48 space-y-4 overflow-y-auto">
          {changed.map((draft) => {
            const stream = streams.find((item) => item.id === draft.streamId);
            const name = stream?.name || `stream ${draft.streamId}`;
            return (
              <section key={draft.streamId} aria-label={`Changes in ${name}`}>
                <h3 className="font-medium [overflow-wrap:anywhere]">
                  {name} · Stream ID: {draft.streamId}
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {offerChanges(draft).map((change) => (
                    <li key={change.id} className="[overflow-wrap:anywhere]">
                      {change.name || "Unnamed offer"} · Offer ID: {change.id}
                      {change.membership &&
                        ` · ${change.membership === "addition" ? "Add" : change.membership === "restoration" ? "Restore" : "Remove"}`}
                      {` · Traffic: ${change.currentShare}% → ${change.proposedShare}%`}
                      {change.currentPinned !== change.proposedPinned &&
                        ` · ${change.proposedPinned ? "Pin" : "Unpin"}`}
                    </li>
                  ))}
                </ul>
                {draftPushError(draft) && (
                  <p className="mt-2 text-sm text-destructive">
                    Cannot push: {draftPushError(draft)}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </details>
    </aside>
  );
}
