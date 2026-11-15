export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function keitaroUrl(path: string): string {
  return `/api/v1/integrations/keitaro/${path}`;
}

export function isApiEnvelope(
  value: unknown,
): value is { data: unknown; error: null } {
  return isRecord(value) && value.error === null && "data" in value;
}

/** HTTP status handling and payload validation belong to the endpoint loader. */
export async function readApiData(
  response: Response,
  invalidMessage: string,
): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(invalidMessage);
  }
  if (!isApiEnvelope(body)) throw new Error(invalidMessage);
  return body.data;
}
