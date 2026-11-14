import {
  createStreamDraft,
  hasChanges,
  type StreamDraft,
} from "./campaign-draft.ts";
import {
  isCampaignDetails,
  type CampaignDetails,
  type CampaignStream,
} from "./campaign-details.ts";

export interface StreamChange {
  stream_id: number;
  offers: { offer_id: number; share: number; state: string }[];
  pinned_offer_ids: number[];
}

export interface CampaignPushResult {
  status: "applied" | "partial" | "failed" | "unknown";
  campaign: CampaignDetails | null;
  pending_streams: StreamChange[];
}

export class PushRejectedError extends Error {}

export function draftPushError(draft: StreamDraft): string | null {
  if (draft.error) return draft.error;
  const attached = draft.offers.filter((offer) => offer.attached);
  if (!attached.length) return "A stream must have at least one offer.";
  if (
    attached.some(
      (offer) =>
        !Number.isInteger(offer.share) || offer.share < 0 || offer.share > 100,
    )
  )
    return "Traffic percentages must be whole numbers between 0 and 100.";
  if (attached.reduce((sum, offer) => sum + offer.share, 0) !== 100)
    return "Traffic percentages must total 100%.";
  if (
    attached.some(
      (offer) => !["active", "disabled"].includes(offer.membershipState),
    )
  )
    return "This stream contains an unsupported membership state.";
  return null;
}

export function proposedChanges(
  drafts: Record<number, StreamDraft>,
): StreamChange[] {
  return Object.values(drafts)
    .filter(hasChanges)
    .map((draft) => {
      const error = draftPushError(draft);
      if (error) throw new RangeError(error);
      const attached = draft.offers.filter((offer) => offer.attached);
      return {
        stream_id: draft.streamId,
        offers: attached.map((offer) => ({
          offer_id: offer.id,
          share: offer.share,
          state: offer.membershipState,
        })),
        pinned_offer_ids: attached
          .filter((offer) => offer.pinned)
          .map((offer) => offer.id),
      };
    });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameChange(value: unknown, expected: StreamChange): boolean {
  if (
    !record(value) ||
    value.stream_id !== expected.stream_id ||
    !Array.isArray(value.offers) ||
    !Array.isArray(value.pinned_offer_ids)
  )
    return false;
  const offers: unknown[] = value.offers;
  const pins: unknown[] = value.pinned_offer_ids;
  return (
    offers.length === expected.offers.length &&
    expected.offers.every((offer) =>
      offers.some(
        (item) =>
          record(item) &&
          item.offer_id === offer.offer_id &&
          item.share === offer.share &&
          item.state === offer.state,
      ),
    ) &&
    pins.length === expected.pinned_offer_ids.length &&
    expected.pinned_offer_ids.every((pin) => pins.includes(pin))
  );
}

function matches(
  change: StreamChange,
  stream: CampaignStream | undefined,
): boolean {
  if (!stream) return false;
  return sameChange(
    {
      stream_id: stream.id,
      offers: stream.offers,
      pinned_offer_ids: stream.pinned_offer_ids,
    },
    change,
  );
}

function parseResult(
  value: unknown,
  campaignId: number,
  changes: StreamChange[],
): CampaignPushResult {
  if (
    !record(value) ||
    typeof value.status !== "string" ||
    !["applied", "partial", "failed", "unknown"].includes(
      String(value.status),
    ) ||
    !Array.isArray(value.pending_streams)
  )
    throw new Error("Could not confirm the Push response.");
  const pending = value.pending_streams;
  const expected =
    value.status === "unknown"
      ? changes
      : changes.filter(
          (change) =>
            !matches(
              change,
              isCampaignDetails(value.campaign, campaignId)
                ? value.campaign.streams.find(
                    (stream) => stream.id === change.stream_id,
                  )
                : undefined,
            ),
        );
  if (
    pending.length !== expected.length ||
    !expected.every((change) =>
      pending.some((item) => sameChange(item, change)),
    )
  )
    throw new Error("Could not confirm the Push response.");
  if (value.status === "unknown") {
    if (value.campaign !== null)
      throw new Error("Could not confirm the Push response.");
    return { status: "unknown", campaign: null, pending_streams: expected };
  }
  if (
    !isCampaignDetails(value.campaign, campaignId) ||
    (value.status === "applied" ? expected.length !== 0 : expected.length === 0)
  )
    throw new Error("Could not confirm the Push response.");
  return {
    status: value.status as "applied" | "partial" | "failed",
    campaign: value.campaign,
    pending_streams: expected,
  };
}

export async function pushCampaign(
  campaignId: number,
  changes: StreamChange[],
): Promise<CampaignPushResult> {
  if (!Number.isSafeInteger(campaignId) || campaignId < 1 || !changes.length)
    throw new RangeError("Push requires a campaign and pending changes.");
  const response = await fetch(
    `/api/v1/integrations/keitaro/campaigns/${campaignId}/push`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ streams: changes }),
    },
  );
  if (response.status === 422)
    throw new PushRejectedError(
      "Push was rejected. Check offer availability and traffic percentages, then try again.",
    );
  if (response.status === 404)
    throw new PushRejectedError(
      "Campaign is unavailable. Your draft has been kept.",
    );
  if (!response.ok) throw new Error("Could not confirm the Push outcome.");
  const body: unknown = await response.json();
  if (!record(body) || body.error !== null)
    throw new Error("Could not confirm the Push response.");
  return parseResult(body.data, campaignId, changes);
}

export function confirmedDrafts(
  campaign: CampaignDetails,
): Record<number, StreamDraft> {
  return Object.fromEntries(
    campaign.streams
      .filter((stream) => stream.schema === "landings")
      .map((stream) => [stream.id, createStreamDraft(stream)]),
  );
}

/** Preserve proposed shares exactly; rebalancing here would change the user's intent. */
export function reconcileDrafts(
  campaign: CampaignDetails,
  previous: Record<number, StreamDraft>,
  pendingIds: readonly number[],
): Record<number, StreamDraft> {
  const result = confirmedDrafts(campaign);
  for (const id of pendingIds) {
    const draft = previous[id];
    if (!draft) throw new Error("Missing pending stream draft.");
    const baseline = result[id];
    if (!baseline) {
      result[id] = {
        ...draft,
        error:
          "This stream is no longer available for offer editing. Cancel to discard its pending changes.",
      };
      continue;
    }
    const desired = draft.offers.filter((offer) => offer.attached);
    const offers = baseline.offers.map((offer) => {
      const target = desired.find((item) => item.id === offer.id);
      return target
        ? {
            ...target,
            ...(offer.attached
              ? {
                  name: offer.name,
                  state: offer.state,
                  membershipState: offer.membershipState,
                }
              : { membershipState: "active" }),
          }
        : { ...offer, attached: false, share: 0, pinned: false };
    });
    offers.push(
      ...desired
        .filter((offer) => !offers.some((item) => item.id === offer.id))
        .map((offer) => ({ ...offer })),
    );
    result[id] = { ...baseline, offers, error: draft.error };
  }
  return result;
}
