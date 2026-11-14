export interface Offer {
  id: number;
  name: string;
  state: string;
}

function isOffer(value: unknown): value is Offer {
  if (typeof value !== "object" || value === null) return false;
  const offer = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(offer.id) &&
    (offer.id as number) > 0 &&
    typeof offer.name === "string" &&
    typeof offer.state === "string"
  );
}

export class OfferUnavailableError extends Error {}

async function load(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/v1/integrations/keitaro/offers${path}`, {
    cache: "no-store",
    signal,
  });
  if (response.status === 404 && !path.startsWith("?"))
    throw new OfferUnavailableError("This offer is no longer available.");
  if (!response.ok) throw new Error("Unable to load offers. Please try again.");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The offer service returned an invalid response.");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("error" in body) ||
    body.error !== null ||
    !("data" in body)
  )
    throw new Error("The offer service returned an invalid response.");
  return body.data;
}

export async function searchOffers(
  query: string,
  signal?: AbortSignal,
): Promise<Offer[]> {
  const data = await load(
    `?${new URLSearchParams({ q: query.trim() })}`,
    signal,
  );
  if (
    !Array.isArray(data) ||
    !data.every(isOffer) ||
    new Set(data.map((offer) => offer.id)).size !== data.length
  )
    throw new Error("The offer service returned an invalid response.");
  return data;
}

export async function getOffer(
  id: number,
  signal?: AbortSignal,
): Promise<Offer> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new RangeError("Offer ID must be a positive safe integer.");
  const data = await load(`/${id}`, signal);
  if (!isOffer(data) || data.id !== id)
    throw new Error("The offer service returned an invalid response.");
  if (data.state === "deleted" || data.state === "archived")
    throw new OfferUnavailableError("This offer is archived or deleted.");
  return data;
}
