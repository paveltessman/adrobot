import { Button } from "@/components/ui/button";
import {
  hasChanges,
  offerChanges,
  type StreamDraft,
} from "@/lib/campaign-draft";
import type { CampaignStream } from "@/lib/campaign-details";

export function CampaignDraftSummary({
  streams,
  drafts,
  onCancel,
}: {
  streams: CampaignStream[];
  drafts: Record<number, StreamDraft>;
  onCancel: () => void;
}) {
  const changed = streams.filter(
    (stream) => drafts[stream.id] && hasChanges(drafts[stream.id]),
  );
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
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled aria-describedby="push-unavailable">
            Push
          </Button>
        </div>
      </div>
      <p id="push-unavailable" className="mt-2 text-sm text-muted-foreground">
        Push is not available yet. Changes are previews only.
      </p>
      <details className="mt-3" open>
        <summary className="cursor-pointer text-sm font-medium">
          Change summary
        </summary>
        <div className="mt-3 max-h-48 space-y-4 overflow-y-auto">
          {changed.map((stream) => (
            <section
              key={stream.id}
              aria-label={`Changes in ${stream.name || `stream ${stream.id}`}`}
            >
              <h3 className="font-medium [overflow-wrap:anywhere]">
                {stream.name || "Unnamed stream"} · Stream ID: {stream.id}
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {offerChanges(drafts[stream.id]).map((change) => (
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
              {drafts[stream.id].error && (
                <p className="mt-2 text-sm text-destructive">
                  Invalid distribution: {drafts[stream.id].error}
                </p>
              )}
            </section>
          ))}
        </div>
      </details>
    </aside>
  );
}
