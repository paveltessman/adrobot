import assert from "node:assert/strict";
import { test } from "node:test";
import type { CampaignStream } from "./campaign-details.ts";
import {
  addOffer,
  cancelDraft,
  createStreamDraft,
  hasChanges,
  membershipStatus,
  offerChanges,
  removeOffer,
  setPinned,
  type StreamDraft,
} from "./campaign-draft.ts";

function stream(shares: number[] = [100], id = 1): CampaignStream {
  return {
    id,
    campaign_id: 7,
    name: "Offers",
    type: "regular",
    state: "active",
    position: 1,
    schema: "landings",
    action_type: "http",
    action_payload: {},
    filters: [],
    offers: shares.map((share, index) => ({
      offer_id: index + 1,
      share,
      state: index === 0 ? "disabled" : "active",
    })),
    offer_details: shares.map((_, index) => ({
      id: index + 1,
      name: `Offer ${index + 1}`,
      state: "active",
    })),
    removed_offers: [
      { id: 9, name: "Historical", last_known_state: "deleted" },
    ],
  };
}

function offer(id: number) {
  return { id, name: `Offer ${id}`, state: "active" };
}

function shares(draft: StreamDraft): number[] {
  return draft.offers.filter((item) => item.attached).map((item) => item.share);
}

test("initialization preserves confirmed shares, states, and committed pins", () => {
  const source = stream([10, 90]);
  const before = structuredClone(source);
  const draft = createStreamDraft(source, [1, 9]);
  assert.deepEqual(shares(draft), [10, 90]);
  assert.equal(draft.offers[0].membershipState, "disabled");
  assert.equal(draft.offers[0].pinned, true);
  assert.equal(draft.offers[2].pinned, false);
  assert.equal(hasChanges(draft), false);
  assert.deepEqual(source, before);
});

test("change summaries include allocation and pin changes without historical noise", () => {
  const initial = createStreamDraft(stream([40, 60]), [1]);
  assert.deepEqual(offerChanges(initial), []);
  const draft = addOffer(removeOffer(initial, 1), offer(9));
  assert.deepEqual(offerChanges(draft), [
    {
      id: 1,
      name: "Offer 1",
      membership: "removal",
      currentShare: 40,
      proposedShare: 0,
      currentPinned: true,
      proposedPinned: false,
    },
    {
      id: 2,
      name: "Offer 2",
      membership: null,
      currentShare: 60,
      proposedShare: 50,
      currentPinned: false,
      proposedPinned: false,
    },
    {
      id: 9,
      name: "Offer 9",
      membership: "restoration",
      currentShare: 0,
      proposedShare: 50,
      currentPinned: false,
      proposedPinned: false,
    },
  ]);
  assert.deepEqual(offerChanges(cancelDraft(draft)), []);
});

test("summaries include pin-only edits and omit additions undone before Push", () => {
  const initial = createStreamDraft(stream());
  const pinned = setPinned(initial, 1, true);
  assert.equal(offerChanges(pinned)[0].proposedPinned, true);
  assert.equal(offerChanges(pinned)[0].currentShare, 100);
  assert.equal(offerChanges(pinned)[0].proposedShare, 100);
  const added = addOffer(initial, offer(2));
  assert.equal(offerChanges(added)[1].membership, "addition");
  assert.deepEqual(offerChanges(removeOffer(added, 2)), []);
});

test("equal balancing matches the documented examples and conserves 100%", () => {
  let draft = createStreamDraft(stream([50, 50]));
  draft = addOffer(draft, offer(3));
  assert.deepEqual(shares(draft), [33, 33, 34]);
  draft = addOffer(draft, offer(4));
  assert.deepEqual(shares(draft), [25, 25, 25, 25]);
  assert.equal(draft.error, null);
  assert.equal(hasChanges(draft), true);
  assert.equal(membershipStatus(draft, 4), "pending addition");

  for (let count = 1; count <= 110; count++) {
    const next = addOffer(
      createStreamDraft(stream(Array(count).fill(0))),
      offer(200),
    );
    assert.equal(
      shares(next).reduce((sum, share) => sum + share, 0),
      100,
    );
    assert.ok(
      shares(next).every((share) => Number.isInteger(share) && share >= 0),
    );
  }
});

test("rounding is independent of catalog or display order", () => {
  const source = stream([50, 50]);
  source.offers.reverse();
  const draft = addOffer(createStreamDraft(source), offer(3));
  assert.deepEqual(
    draft.offers
      .filter((item) => item.attached)
      .map(({ id, share }) => [id, share]),
    [
      [2, 33],
      [1, 33],
      [3, 34],
    ],
  );
});

test("pins preserve displayed allocations and unpinning rebalances", () => {
  let draft = createStreamDraft(stream([33, 33, 34]));
  draft = setPinned(draft, 1, true);
  draft = addOffer(draft, offer(4));
  assert.deepEqual(shares(draft), [33, 22, 22, 23]);
  draft = removeOffer(draft, 2);
  assert.deepEqual(shares(draft), [33, 33, 34]);
  draft = setPinned(draft, 1, false);
  assert.deepEqual(shares(draft), [33, 33, 34]);
  draft = addOffer(draft, offer(5));
  assert.deepEqual(shares(draft), [25, 25, 25, 25]);
});

test("removing a pin releases traffic; restoring reuses its entry unpinned", () => {
  const initial = createStreamDraft(stream([40, 60]), [1]);
  const removed = removeOffer(initial, 1);
  assert.deepEqual(shares(removed), [100]);
  assert.equal(membershipStatus(removed, 1), "pending removal");
  const restored = addOffer(removed, offer(1));
  assert.deepEqual(shares(restored), [50, 50]);
  assert.equal(restored.offers.filter((item) => item.id === 1).length, 1);
  assert.equal(restored.offers[0].pinned, false);
  assert.equal(restored.offers[0].membershipState, "disabled");
  assert.equal(membershipStatus(restored, 1), "attached");
  assert.equal(addOffer(restored, offer(1)), restored);
});

test("historical restoration uses fresh details and adding to empty streams works", () => {
  const initial = createStreamDraft(stream([]));
  assert.equal(membershipStatus(initial, 9), "removed");
  const restored = addOffer(initial, offer(9));
  assert.equal(restored.offers.length, 1);
  assert.equal(restored.offers[0].name, "Offer 9");
  assert.equal(restored.offers[0].state, "active");
  assert.equal(restored.offers[0].pinned, false);
  assert.deepEqual(shares(restored), [100]);
  assert.equal(membershipStatus(restored, 9), "pending addition");
});

test("invalid distributions retain pins and can be corrected", () => {
  const lastRemoved = removeOffer(createStreamDraft(stream()), 1);
  assert.match(lastRemoved.error!, /at least one/);
  assert.equal(addOffer(lastRemoved, offer(1)).error, null);

  const allPinned = createStreamDraft(stream([40, 60]), [1, 2]);
  const invalid = removeOffer(allPinned, 2);
  assert.match(invalid.error!, /do not total 100/);
  assert.equal(invalid.offers[0].share, 40);
  assert.equal(invalid.offers[0].pinned, true);
  assert.deepEqual(shares(setPinned(invalid, 1, false)), [100]);

  const excess = addOffer(
    createStreamDraft(stream([60, 60]), [1, 2]),
    offer(3),
  );
  assert.match(excess.error!, /exceed 100/);
  assert.deepEqual(shares(excess), [60, 60, 0]);
  assert.throws(() => setPinned(excess, 3, true), /invalid distribution/);
  assert.equal(setPinned(excess, 1, false).error, null);

  const fractional = addOffer(createStreamDraft(stream([33.5]), [1]), offer(2));
  assert.match(fractional.error!, /whole numbers/);
});

test("fully allocated pins permit zero shares without changing pins", () => {
  const initial = createStreamDraft(stream([100]), [1]);
  const added = addOffer(initial, offer(2));
  assert.deepEqual(shares(added), [100, 0]);
  assert.equal(added.error, null);
  assert.equal(setPinned(added, 2, true).error, null);
});

test("cancel restores membership, shares, and pins without mutating earlier state", () => {
  const source = stream([40, 60]);
  const initial = createStreamDraft(source, [1]);
  const before = structuredClone(initial);
  const draft = addOffer(removeOffer(initial, 1), offer(9));
  const canceled = cancelDraft(draft);
  assert.deepEqual(initial, before);
  assert.deepEqual(canceled.offers, initial.offers);
  assert.equal(hasChanges(canceled), false);
  assert.equal(canceled.error, null);
  assert.equal(hasChanges(setPinned(initial, 1, false)), true);
});

test("net-zero edits are clean and different streams remain independent", () => {
  const first = createStreamDraft(stream());
  const second = createStreamDraft(stream([100], 2));
  assert.equal(hasChanges(removeOffer(addOffer(first, offer(2)), 2)), false);
  assert.equal(hasChanges(addOffer(removeOffer(first, 1), offer(1))), false);
  assert.equal(
    hasChanges(setPinned(setPinned(first, 1, true), 1, false)),
    false,
  );
  assert.deepEqual(shares(second), [100]);
  assert.equal(second.streamId, 2);
  assert.equal(hasChanges(second), false);
});

test("invalid actions fail explicitly", () => {
  const draft = createStreamDraft(stream());
  assert.throws(() => removeOffer(draft, 999), RangeError);
  assert.throws(() => membershipStatus(draft, 999), RangeError);
  assert.throws(() => setPinned(draft, 9, true), /Removed offers/);
  for (const id of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => addOffer(draft, offer(id)), RangeError);
});
