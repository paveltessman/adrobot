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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStream(value: unknown, campaignId: number): value is CampaignStream {
  if (!record(value)) return false;
  const memberships = value.offers;
  const details = value.offer_details;
  const removed = value.removed_offers;
  return (
    id(value.id) &&
    value.campaign_id === campaignId &&
    ["name", "type", "state", "schema", "action_type"].every(
      (key) => typeof value[key] === "string",
    ) &&
    Number.isSafeInteger(value.position) &&
    (value.action_payload === null ||
      typeof value.action_payload === "string" ||
      record(value.action_payload) ||
      Array.isArray(value.action_payload)) &&
    Array.isArray(value.filters) &&
    value.filters.every(record) &&
    Array.isArray(memberships) &&
    memberships.every(
      (item: unknown) =>
        record(item) &&
        id(item.offer_id) &&
        Number.isSafeInteger(item.share) &&
        typeof item.state === "string",
    ) &&
    Array.isArray(details) &&
    details.every(
      (item: unknown) =>
        record(item) &&
        id(item.id) &&
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
        record(item) &&
        id(item.id) &&
        typeof item.name === "string" &&
        typeof item.last_known_state === "string",
    ) &&
    new Set(removed.map((item) => item.id)).size === removed.length &&
    removed.every((item) =>
      memberships.every((membership) => membership.offer_id !== item.id),
    )
  );
}

function isDetails(
  value: unknown,
  campaignId: number,
): value is CampaignDetails {
  return (
    record(value) &&
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
  if (!id(campaignId))
    throw new RangeError("Campaign ID must be a positive safe integer");
  const response = await fetch(
    `/api/v1/integrations/keitaro/campaigns/${campaignId}`,
    { cache: "no-store", signal },
  );
  if (response.status === 404)
    throw new CampaignNotFoundError("Campaign not found");
  if (!response.ok)
    throw new Error("Unable to load campaign. Please try again.");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The campaign service returned an invalid response.");
  }
  if (!record(body) || body.error !== null || !isDetails(body.data, campaignId))
    throw new Error("The campaign service returned an invalid response.");
  return body.data;
}
