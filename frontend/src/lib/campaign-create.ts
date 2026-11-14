import { isCampaignDetails } from "./campaign-details.ts";
import type { Offer } from "./offers.ts";

export interface CreationOption {
  id: number;
  name: string;
}

export interface CreationSelectors {
  domains: CreationOption[];
  groups: CreationOption[];
  sources: CreationOption[];
}

export interface CreationDraft {
  name: string;
  countryCode: string;
  offer: Offer | null;
  domainId: string;
  groupId: string;
  sourceId: string;
}

export interface CreationRequest {
  name: string;
  country_code: string;
  offer_id: number;
  domain_id: number;
  group_id: number;
  traffic_source_id: number;
}

export type CreationResult =
  | { status: "created" | "partial"; campaignId: number }
  | { status: "unknown"; campaignId: number | null }
  | { status: "failed"; campaignId: null };

export class CreationRejectedError extends Error {}
export class CreationUnknownError extends Error {
  readonly campaignId: number | null;

  constructor(campaignId: number | null = null) {
    super("Could not confirm the creation outcome.");
    this.campaignId = campaignId;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function availableOffer(offer: Offer): boolean {
  return ["active", "disabled"].includes(offer.state);
}

export function creationRequest(draft: CreationDraft): CreationRequest {
  const name = draft.name.trim();
  const country = draft.countryCode.trim().toUpperCase();
  if (!name) throw new RangeError("Enter a campaign name.");
  if (!/^[A-Z]{2}$/.test(country))
    throw new RangeError("Enter a two-letter country code, such as AU.");
  if (!draft.offer || !id(draft.offer.id) || !availableOffer(draft.offer))
    throw new RangeError("Select an available offer.");
  const selectors = [draft.domainId, draft.groupId, draft.sourceId];
  if (
    selectors.some((value) => !/^[1-9]\d*$/.test(value) || !id(Number(value)))
  )
    throw new RangeError(
      "Select a domain, campaign group, and traffic source.",
    );
  return {
    name,
    country_code: country,
    offer_id: draft.offer.id,
    domain_id: Number(draft.domainId),
    group_id: Number(draft.groupId),
    traffic_source_id: Number(draft.sourceId),
  };
}

export function creationError(draft: CreationDraft): string | null {
  try {
    creationRequest(draft);
    return null;
  } catch (error) {
    return error instanceof RangeError
      ? error.message
      : "Check the form fields.";
  }
}

async function loadOptions(
  path: string,
  signal?: AbortSignal,
): Promise<CreationOption[]> {
  const response = await fetch(`/api/v1/integrations/keitaro/${path}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Could not load campaign options.");
  const body: unknown = await response.json();
  if (!record(body) || body.error !== null || !Array.isArray(body.data))
    throw new Error("Invalid campaign options.");
  const options: unknown[] = body.data;
  if (
    !options.every(
      (option): option is CreationOption =>
        record(option) && id(option.id) && typeof option.name === "string",
    ) ||
    new Set(options.map((option) => option.id)).size !== options.length
  )
    throw new Error("Invalid campaign options.");
  return options;
}

export async function getCreationSelectors(
  signal?: AbortSignal,
): Promise<CreationSelectors> {
  const [domains, groups, sources] = await Promise.all([
    loadOptions("domains", signal),
    loadOptions("campaign-groups", signal),
    loadOptions("traffic-sources", signal),
  ]);
  return { domains, groups, sources };
}

function parseResult(body: unknown): CreationResult {
  const data = record(body) && record(body.data) ? body.data : null;
  const campaignId = data && id(data.campaign_id) ? data.campaign_id : null;
  if (!record(body) || body.error !== null || !data)
    throw new CreationUnknownError(campaignId);
  if (
    (data.status === "created" || data.status === "partial") &&
    campaignId &&
    isCampaignDetails(data.campaign, campaignId)
  )
    return { status: data.status, campaignId };
  if (
    data.status === "unknown" &&
    data.campaign === null &&
    (data.campaign_id === null || campaignId !== null)
  )
    return { status: "unknown", campaignId };
  if (
    data.status === "failed" &&
    data.campaign_id === null &&
    data.campaign === null
  )
    return { status: "failed", campaignId: null };
  throw new CreationUnknownError(campaignId);
}

export async function createCampaign(
  draft: CreationDraft,
): Promise<CreationResult> {
  const payload = creationRequest(draft);
  try {
    const response = await fetch("/api/v1/integrations/keitaro/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    if (response.status === 422)
      throw new CreationRejectedError(
        "Creation was rejected. Check the fields and resource availability, then try again.",
      );
    if (!response.ok) throw new CreationUnknownError();
    return parseResult(await response.json());
  } catch (error) {
    if (
      error instanceof CreationRejectedError ||
      error instanceof CreationUnknownError
    )
      throw error;
    throw new CreationUnknownError();
  }
}
