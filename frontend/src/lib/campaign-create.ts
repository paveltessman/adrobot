import {
  isRecord,
  isPositiveId,
  keitaroUrl,
  readApiData,
  isApiEnvelope,
} from "./keitaro-api.ts";
import type { MessageKey } from "./i18n/index.ts";
import { LocalizedError, LocalizedRangeError } from "./i18n/errors.ts";
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
  countryCodes: string;
  offer: Offer | null;
  domainId: string;
  groupId: string;
  sourceId: string;
}

export interface CreationRequest {
  name: string;
  country_codes: string[];
  offer_id: number;
  domain_id: number | null;
  group_id: number | null;
  traffic_source_id: number | null;
}

export type CreationResult =
  | { status: "created" | "partial"; campaignId: number }
  | { status: "unknown"; campaignId: number | null }
  | { status: "failed"; campaignId: null };

export class CreationRejectedError extends LocalizedError {}
export class CreationUnknownError extends Error {
  readonly campaignId: number | null;

  constructor(campaignId: number | null = null) {
    super("Could not confirm the creation outcome.");
    this.campaignId = campaignId;
  }
}

export function availableOffer(offer: Offer): boolean {
  return ["active", "disabled"].includes(offer.state);
}

export function parseCountryCodes(value: string): string[] {
  return [
    ...new Set(
      value
        .trim()
        .toUpperCase()
        .split(/[,\s]+/)
        .filter(Boolean),
    ),
  ].sort();
}

function optionalId(value: string): number | null {
  if (value === "") return null;
  if (!/^[1-9]\d*$/.test(value) || !isPositiveId(Number(value)))
    throw new LocalizedRangeError("validOptional");
  return Number(value);
}

export function creationRequest(draft: CreationDraft): CreationRequest {
  const name = draft.name.trim();
  const countries = parseCountryCodes(draft.countryCodes);
  if (!name) throw new LocalizedRangeError("enterCampaignName");
  if (
    !countries.length ||
    countries.some((country) => !/^[A-Z]{2}$/.test(country))
  )
    throw new LocalizedRangeError("enterCountryCodes");
  if (
    !draft.offer ||
    !isPositiveId(draft.offer.id) ||
    !availableOffer(draft.offer)
  )
    throw new LocalizedRangeError("selectAvailableOffer");
  return {
    name,
    country_codes: countries,
    offer_id: draft.offer.id,
    domain_id: optionalId(draft.domainId),
    group_id: optionalId(draft.groupId),
    traffic_source_id: optionalId(draft.sourceId),
  };
}

export function creationError(draft: CreationDraft): MessageKey | null {
  try {
    creationRequest(draft);
    return null;
  } catch (error) {
    return error instanceof LocalizedRangeError ? error.key : "checkFields";
  }
}

async function loadOptions(
  path: string,
  signal?: AbortSignal,
): Promise<CreationOption[]> {
  const response = await fetch(keitaroUrl(path), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Could not load campaign options.");
  const options = await readApiData(response, "Invalid campaign options.");
  if (!Array.isArray(options)) throw new Error("Invalid campaign options.");
  if (
    !options.every(
      (option): option is CreationOption =>
        isRecord(option) &&
        isPositiveId(option.id) &&
        typeof option.name === "string",
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
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  const campaignId =
    data && isPositiveId(data.campaign_id) ? data.campaign_id : null;
  if (!isApiEnvelope(body) || !data) throw new CreationUnknownError(campaignId);
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
    const response = await fetch(keitaroUrl("campaigns"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    if (response.status === 422)
      throw new CreationRejectedError("creationRejected");
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
