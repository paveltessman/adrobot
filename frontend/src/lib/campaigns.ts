export interface Campaign {
  id: number;
  name: string;
}

export interface CampaignPage {
  items: Campaign[];
  limit: number;
  offset: number;
  has_more: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCampaign(value: unknown): value is Campaign {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    typeof value.name === "string"
  );
}

function isCampaignPage(value: unknown): value is CampaignPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isCampaign) &&
    typeof value.limit === "number" &&
    Number.isInteger(value.limit) &&
    value.limit >= 1 &&
    value.limit <= 100 &&
    typeof value.offset === "number" &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0 &&
    typeof value.has_more === "boolean" &&
    value.items.length <= value.limit
  );
}

/** Browser loader: all requests go through the website's own origin. */
export async function getCampaigns({
  limit = 100,
  offset = 0,
  signal,
}: {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<CampaignPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Campaign limit must be an integer from 1 to 100");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Campaign offset must be a nonnegative safe integer");
  }

  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(
    `/api/v1/integrations/keitaro/campaigns?${query}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    throw new Error("Unable to load campaigns. Please try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The campaign service returned an invalid response.");
  }
  if (
    !isRecord(body) ||
    body.error !== null ||
    !isCampaignPage(body.data) ||
    body.data.limit !== limit ||
    body.data.offset !== offset
  ) {
    throw new Error("The campaign service returned an invalid response.");
  }
  return body.data;
}
