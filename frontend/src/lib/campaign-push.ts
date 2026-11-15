import {
  isRecord,
  isPositiveId,
  keitaroUrl,
  readApiData,
} from "./keitaro-api.ts";
import type { MessageKey } from "./i18n/index.ts";
import { LocalizedError, LocalizedRangeError } from "./i18n/errors.ts";
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

export class PushRejectedError extends LocalizedError {}

export function draftPushError(draft: StreamDraft): MessageKey | null {
  if (draft.error) return draft.error;
  const attached = draft.offers.filter((offer) => offer.attached);
  if (!attached.length) return "streamNeedsOffer";
  if (
    attached.some(
      (offer) =>
        !Number.isInteger(offer.share) || offer.share < 0 || offer.share > 100,
    )
  )
    return "trafficWhole";
  if (attached.reduce((sum, offer) => sum + offer.share, 0) !== 100)
    return "trafficTotal";
  if (
    attached.some(
      (offer) => !["active", "disabled"].includes(offer.membershipState),
    )
  )
    return "unsupportedMembership";
  return null;
}

export function proposedChanges(
  drafts: Record<number, StreamDraft>,
): StreamChange[] {
  return Object.values(drafts)
    .filter(hasChanges)
    .map((draft) => {
      const error = draftPushError(draft);
      if (error) throw new LocalizedRangeError(error);
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

function sameChange(value: unknown, expected: StreamChange): boolean {
  if (
    !isRecord(value) ||
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
          isRecord(item) &&
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
    !isRecord(value) ||
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
  if (!isPositiveId(campaignId) || !changes.length)
    throw new RangeError("Push requires a campaign and pending changes.");
  const response = await fetch(keitaroUrl(`campaigns/${campaignId}/push`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ streams: changes }),
  });
  if (response.status === 422) throw new PushRejectedError("pushRejected");
  if (response.status === 404)
    throw new PushRejectedError("pushCampaignUnavailable");
  if (!response.ok) throw new Error("Could not confirm the Push outcome.");
  const data = await readApiData(
    response,
    "Could not confirm the Push response.",
  );
  return parseResult(data, campaignId, changes);
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
        error: "streamUnavailable",
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
