import {
  isRecord,
  isPositiveId,
  keitaroUrl,
  readApiData,
} from "./keitaro-api.ts";
import { LocalizedError } from "./i18n/errors.ts";
export interface Offer {
  id: number;
  name: string;
  state: string;
}

function isOffer(value: unknown): value is Offer {
  return (
    isRecord(value) &&
    isPositiveId(value.id) &&
    typeof value.name === "string" &&
    typeof value.state === "string"
  );
}

export class OfferUnavailableError extends LocalizedError {}

async function load(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(keitaroUrl(`offers${path}`), {
    cache: "no-store",
    signal,
  });
  if (response.status === 404 && !path.startsWith("?"))
    throw new OfferUnavailableError("offerNoLongerAvailable");
  if (!response.ok) throw new Error("Unable to load offers. Please try again.");
  return readApiData(
    response,
    "The offer service returned an invalid response.",
  );
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
  if (!isPositiveId(id))
    throw new RangeError("Offer ID must be a positive safe integer.");
  const data = await load(`/${id}`, signal);
  if (!isOffer(data) || data.id !== id)
    throw new Error("The offer service returned an invalid response.");
  if (data.state === "deleted" || data.state === "archived")
    throw new OfferUnavailableError("offerArchivedDeleted");
  return data;
}
