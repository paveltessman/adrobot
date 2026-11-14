import type { CampaignStream } from "./campaign-details.ts";

export interface DraftOffer {
  id: number;
  name: string;
  state: string;
  membershipState: string;
  attached: boolean;
  share: number;
  pinned: boolean;
}

export interface StreamDraft {
  streamId: number;
  baseline: readonly DraftOffer[];
  offers: readonly DraftOffer[];
  error: string | null;
}

export type MembershipStatus =
  "attached" | "pending addition" | "pending removal" | "removed";

export function createStreamDraft(
  stream: CampaignStream,
  pinnedIds: readonly number[] = [],
): StreamDraft {
  const offers: DraftOffer[] = stream.offers.map((membership) => {
    const detail = stream.offer_details.find(
      (offer) => offer.id === membership.offer_id,
    )!;
    return {
      ...detail,
      membershipState: membership.state,
      attached: true,
      share: membership.share,
      pinned: pinnedIds.includes(detail.id),
    };
  });
  offers.push(
    ...stream.removed_offers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      state: offer.last_known_state,
      membershipState: "active",
      attached: false,
      share: 0,
      pinned: false,
    })),
  );
  // Preserve the confirmed distribution until the user makes an edit.
  return {
    streamId: stream.id,
    baseline: offers.map((offer) => ({ ...offer })),
    offers,
    error: null,
  };
}

function balance(draft: StreamDraft, offers: DraftOffer[]): StreamDraft {
  const attached = offers.filter((offer) => offer.attached);
  const pinned = attached.filter((offer) => offer.pinned);
  const automatic = attached
    .filter((offer) => !offer.pinned)
    .sort((a, b) => a.id - b.id);
  const remaining = 100 - pinned.reduce((sum, offer) => sum + offer.share, 0);
  let error: string | null = null;
  if (attached.length === 0) error = "A stream must have at least one offer.";
  else if (
    pinned.some(
      (offer) =>
        !Number.isInteger(offer.share) || offer.share < 0 || offer.share > 100,
    )
  )
    error = "Pinned percentages must be whole numbers between 0 and 100.";
  else if (remaining < 0) error = "Pinned allocations exceed 100%.";
  else if (automatic.length === 0 && remaining !== 0)
    error = "All offers are pinned but their allocations do not total 100%.";

  const shares = new Map<number, number>();
  if (!error && automatic.length > 0) {
    const share = Math.floor(remaining / automatic.length);
    const remainder = remaining % automatic.length;
    // Award remainder points to the highest IDs, independently of display order.
    automatic.forEach((offer, index) =>
      shares.set(
        offer.id,
        share + (index >= automatic.length - remainder ? 1 : 0),
      ),
    );
  }
  return {
    ...draft,
    offers: offers.map((offer) => ({
      ...offer,
      share: offer.attached ? (shares.get(offer.id) ?? offer.share) : 0,
    })),
    error,
  };
}

function findOffer(draft: StreamDraft, offerId: number): DraftOffer {
  const offer = draft.offers.find((item) => item.id === offerId);
  if (!offer) throw new RangeError("Offer is not in this stream draft.");
  return offer;
}

/** Call only after checking the offer's current availability with the backend. */
export function addOffer(
  draft: StreamDraft,
  offer: { id: number; name: string; state: string },
): StreamDraft {
  if (!Number.isSafeInteger(offer.id) || offer.id <= 0)
    throw new RangeError("Offer ID must be a positive safe integer.");
  const existing = draft.offers.find((item) => item.id === offer.id);
  if (existing?.attached) return draft;
  const added: DraftOffer = {
    ...offer,
    membershipState: existing?.membershipState ?? "active",
    attached: true,
    share: 0,
    pinned: false,
  };
  return balance(
    draft,
    existing
      ? draft.offers.map((item) => (item.id === offer.id ? added : { ...item }))
      : [...draft.offers.map((item) => ({ ...item })), added],
  );
}

export function removeOffer(draft: StreamDraft, offerId: number): StreamDraft {
  const offer = findOffer(draft, offerId);
  if (!offer.attached) return draft;
  return balance(
    draft,
    draft.offers.map((item) =>
      item.id === offerId
        ? { ...item, attached: false, pinned: false, share: 0 }
        : { ...item },
    ),
  );
}

export function setPinned(
  draft: StreamDraft,
  offerId: number,
  pinned: boolean,
): StreamDraft {
  const offer = findOffer(draft, offerId);
  if (!offer.attached) throw new Error("Removed offers cannot be pinned.");
  if (offer.pinned === pinned) return draft;
  if (pinned && draft.error)
    throw new Error(
      "Resolve the invalid distribution before pinning an offer.",
    );
  return balance(
    draft,
    draft.offers.map((item) =>
      item.id === offerId ? { ...item, pinned } : { ...item },
    ),
  );
}

export function membershipStatus(
  draft: StreamDraft,
  offerId: number,
): MembershipStatus {
  const offer = findOffer(draft, offerId);
  const wasAttached = draft.baseline.some(
    (item) => item.id === offerId && item.attached,
  );
  if (offer.attached) return wasAttached ? "attached" : "pending addition";
  return wasAttached ? "pending removal" : "removed";
}

export function hasChanges(draft: StreamDraft): boolean {
  const baseline = draft.baseline.filter((offer) => offer.attached);
  const proposed = draft.offers.filter((offer) => offer.attached);
  return (
    baseline.length !== proposed.length ||
    proposed.some((offer) => {
      const previous = baseline.find((item) => item.id === offer.id);
      return (
        !previous ||
        previous.share !== offer.share ||
        previous.pinned !== offer.pinned ||
        previous.membershipState !== offer.membershipState
      );
    })
  );
}

export function cancelDraft(draft: StreamDraft): StreamDraft {
  return {
    ...draft,
    offers: draft.baseline.map((offer) => ({ ...offer })),
    error: null,
  };
}
