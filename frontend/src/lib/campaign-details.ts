import {
  isRecord,
  isPositiveId,
  keitaroUrl,
  readApiData,
} from "./keitaro-api.ts";
export interface StreamOffer {
  offer_id: number;
  share: number;
  state: string;
}

export interface CampaignStream {
  id: number;
  campaign_id: number;
  name: string;
  type: string;
  state: string;
  position: number;
  schema: string;
  action_type: string;
  action_payload: string | Record<string, unknown> | unknown[] | null;
  filters: Record<string, unknown>[];
  offers: StreamOffer[];
  offer_details: { id: number; name: string; state: string }[];
  removed_offers: { id: number; name: string; last_known_state: string }[];
  pinned_offer_ids: number[];
}

export interface CampaignDetails {
  id: number;
  name: string;
  alias: string | null;
  state: string | null;
  domain_id: number | null;
  group_id: number | null;
  traffic_source_id: number | null;
  notes: string | null;
  updated_at: string | null;
  streams: CampaignStream[];
}

function isStream(value: unknown, campaignId: number): value is CampaignStream {
  if (!isRecord(value)) return false;
  const memberships = value.offers;
  const details = value.offer_details;
  const removed = value.removed_offers;
  const pins = value.pinned_offer_ids;
  return (
    isPositiveId(value.id) &&
    value.campaign_id === campaignId &&
    ["name", "type", "state", "schema", "action_type"].every(
      (key) => typeof value[key] === "string",
    ) &&
    Number.isSafeInteger(value.position) &&
    (value.action_payload === null ||
      typeof value.action_payload === "string" ||
      isRecord(value.action_payload) ||
      Array.isArray(value.action_payload)) &&
    Array.isArray(value.filters) &&
    value.filters.every(isRecord) &&
    Array.isArray(memberships) &&
    Array.isArray(pins) &&
    pins.every((pin: unknown) => isPositiveId(pin)) &&
    new Set(pins).size === pins.length &&
    pins.every((pin) =>
      memberships.some(
        (item: unknown) => isRecord(item) && item.offer_id === pin,
      ),
    ) &&
    memberships.every(
      (item: unknown) =>
        isRecord(item) &&
        isPositiveId(item.offer_id) &&
        Number.isSafeInteger(item.share) &&
        typeof item.state === "string",
    ) &&
    Array.isArray(details) &&
    details.every(
      (item: unknown) =>
        isRecord(item) &&
        isPositiveId(item.id) &&
        typeof item.name === "string" &&
        typeof item.state === "string",
    ) &&
    new Set(memberships.map((item) => item.offer_id)).size ===
      memberships.length &&
    new Set(details.map((item) => item.id)).size === details.length &&
    details.length === memberships.length &&
    memberships.every((item) =>
      details.some((detail) => detail.id === item.offer_id),
    ) &&
    Array.isArray(removed) &&
    removed.every(
      (item: unknown) =>
        isRecord(item) &&
        isPositiveId(item.id) &&
        typeof item.name === "string" &&
        typeof item.last_known_state === "string",
    ) &&
    new Set(removed.map((item) => item.id)).size === removed.length &&
    removed.every((item) =>
      memberships.every((membership) => membership.offer_id !== item.id),
    )
  );
}

export function isCampaignDetails(
  value: unknown,
  campaignId: number,
): value is CampaignDetails {
  return (
    isRecord(value) &&
    value.id === campaignId &&
    typeof value.name === "string" &&
    ["alias", "state", "notes", "updated_at"].every(
      (key) => value[key] === null || typeof value[key] === "string",
    ) &&
    ["domain_id", "group_id", "traffic_source_id"].every(
      (key) =>
        value[key] === null ||
        (typeof value[key] === "number" && Number.isSafeInteger(value[key])),
    ) &&
    Array.isArray(value.streams) &&
    value.streams.every((stream: unknown) => isStream(stream, campaignId)) &&
    new Set(value.streams.map((stream) => stream.id)).size ===
      value.streams.length
  );
}

export class CampaignNotFoundError extends Error {}

export async function getCampaignDetails(
  campaignId: number,
  signal?: AbortSignal,
): Promise<CampaignDetails> {
  if (!isPositiveId(campaignId))
    throw new RangeError("Campaign ID must be a positive safe integer");
  const response = await fetch(keitaroUrl(`campaigns/${campaignId}`), {
    cache: "no-store",
    signal,
  });
  if (response.status === 404)
    throw new CampaignNotFoundError("Campaign not found");
  if (!response.ok)
    throw new Error("Unable to load campaign. Please try again.");
  const data = await readApiData(
    response,
    "The campaign service returned an invalid response.",
  );
  if (!isCampaignDetails(data, campaignId))
    throw new Error("The campaign service returned an invalid response.");
  return data;
}
