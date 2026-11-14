import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  addOffer,
  cancelDraft,
  createStreamDraft,
  hasChanges,
  removeOffer,
  setPinned,
} from "./campaign-draft.ts";
import type { CampaignDetails, CampaignStream } from "./campaign-details.ts";
import {
  confirmedDrafts,
  draftPushError,
  proposedChanges,
  pushCampaign,
  PushRejectedError,
  reconcileDrafts,
  type StreamChange,
} from "./campaign-push.ts";

function stream(id = 1, offerId = 9): CampaignStream {
  return {
    id,
    campaign_id: 7,
    name: `Stream ${id}`,
    type: "regular",
    state: "active",
    position: id,
    schema: "landings",
    action_type: "http",
    action_payload: {},
    filters: [],
    offers: [{ offer_id: offerId, share: 100, state: "disabled" }],
    offer_details: [{ id: offerId, name: `Offer ${offerId}`, state: "active" }],
    removed_offers: [],
    pinned_offer_ids: [],
  };
}
function campaign(streams = [stream()]): CampaignDetails {
  return {
    id: 7,
    name: "Campaign",
    alias: null,
    state: "active",
    domain_id: null,
    group_id: null,
    traffic_source_id: null,
    notes: null,
    updated_at: null,
    streams,
  };
}
const proposal: StreamChange = {
  stream_id: 1,
  offers: [{ offer_id: 9, share: 100, state: "disabled" }],
  pinned_offer_ids: [9],
};
afterEach(() => mock.restoreAll());

test("serializes changed streams, attached offers, membership states, and pins only", () => {
  const baseline = createStreamDraft(stream());
  const changed = setPinned(
    addOffer(baseline, { id: 10, name: "New", state: "active" }),
    9,
    true,
  );
  const before = structuredClone(changed);
  assert.deepEqual(
    proposedChanges({ 1: changed, 2: createStreamDraft(stream(2, 11)) }),
    [
      {
        stream_id: 1,
        offers: [
          { offer_id: 9, share: 50, state: "disabled" },
          { offer_id: 10, share: 50, state: "active" },
        ],
        pinned_offer_ids: [9],
      },
    ],
  );
  assert.deepEqual(changed, before);
  assert.deepEqual(proposedChanges({ 1: cancelDraft(changed) }), []);
});

test("rejects empty or invalid distributions and unsupported membership states", () => {
  const initial = createStreamDraft(stream());
  const empty = removeOffer(initial, 9);
  assert.match(draftPushError(empty)!, /at least one/);
  assert.throws(() => proposedChanges({ 1: empty }), RangeError);
  for (const share of [-1, 101, 33.5, NaN]) {
    const draft = { ...initial, offers: [{ ...initial.offers[0], share }] };
    assert.match(draftPushError(draft)!, /whole numbers/);
  }
  assert.match(
    draftPushError({
      ...initial,
      offers: [{ ...initial.offers[0], share: 90 }],
    })!,
    /total 100/,
  );
  assert.match(
    draftPushError({
      ...initial,
      offers: [{ ...initial.offers[0], membershipState: "deleted" }],
    })!,
    /unsupported/,
  );
});

test("reconciles partial completion without rebalancing and Cancel uses the new baseline", () => {
  const first = setPinned(createStreamDraft(stream()), 9, true);
  const second = addOffer(createStreamDraft(stream(2, 11)), {
    id: 12,
    name: "New",
    state: "active",
  });
  const saved = { ...stream(), pinned_offer_ids: [9] };
  const normalized = {
    ...stream(2, 11),
    offers: [
      { offer_id: 11, share: 70, state: "disabled" },
      { offer_id: 12, share: 30, state: "active" },
    ],
    offer_details: [
      { id: 11, name: "Renamed", state: "active" },
      { id: 12, name: "New", state: "active" },
    ],
  };
  const drafts = reconcileDrafts(
    campaign([saved, normalized]),
    { 1: first, 2: second },
    [2],
  );
  assert.equal(hasChanges(drafts[1]), false);
  assert.deepEqual(
    drafts[2].offers.map((offer) => offer.share),
    [50, 50],
  );
  assert.deepEqual(
    cancelDraft(drafts[2]).offers.map((offer) => offer.share),
    [70, 30],
  );
  assert.equal(drafts[2].offers[0].name, "Renamed");
});

test("keeps unsaved additions and stages removals against confirmed membership", () => {
  const desired = addOffer(removeOffer(createStreamDraft(stream()), 9), {
    id: 10,
    name: "New",
    state: "active",
  });
  const drafts = reconcileDrafts(campaign(), { 1: desired }, [1]);
  assert.deepEqual(
    drafts[1].offers.map((offer) => [offer.id, offer.attached, offer.share]),
    [
      [9, false, 0],
      [10, true, 100],
    ],
  );
  assert.deepEqual(proposedChanges(drafts)[0].offers, [
    { offer_id: 10, share: 100, state: "active" },
  ]);
});

test("missing streams keep a blocked draft, while Cancel can discard it", () => {
  const previous = { 1: setPinned(createStreamDraft(stream()), 9, true) };
  const drafts = reconcileDrafts(campaign([]), previous, [1]);
  assert.equal(hasChanges(drafts[1]), true);
  assert.match(draftPushError(drafts[1])!, /no longer available/);
  assert.deepEqual(confirmedDrafts(campaign([])), {});
});

test("unknown-outcome refresh retains uncommitted pins", () => {
  const desired = setPinned(createStreamDraft(stream()), 9, true);
  const drafts = reconcileDrafts(campaign(), { 1: desired }, [1]);
  assert.equal(hasChanges(drafts[1]), true);
  assert.equal(drafts[1].offers[0].pinned, true);
  assert.equal(drafts[1].baseline[0].pinned, false);
});

for (const status of ["applied", "partial", "failed", "unknown"] as const) {
  test(`accepts ${status} outcome and sends one POST`, async () => {
    const data = {
      status,
      campaign:
        status === "unknown"
          ? null
          : campaign([
              {
                ...stream(),
                pinned_offer_ids: status === "applied" ? [9] : [],
              },
            ]),
      pending_streams: status === "applied" ? [] : [proposal],
      message: null,
    };
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    const result = await pushCampaign(7, [proposal]);
    assert.equal(result.status, status);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(fetchMock.mock.calls[0].arguments, [
      "/api/v1/integrations/keitaro/campaigns/7/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ streams: [proposal] }),
      },
    ]);
  });
}

for (const status of [404, 422, 500, 502, 504]) {
  test(`HTTP ${status} never exposes upstream details or triggers a retry`, async () => {
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () => new Response("private", { status }),
    );
    await assert.rejects(
      pushCampaign(7, [proposal]),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes("private") &&
        (status === 404 || status === 422
          ? error instanceof PushRejectedError
          : !(error instanceof PushRejectedError)),
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("rejects malformed and contradictory outcomes instead of clearing drafts", async () => {
  for (const data of [
    null,
    {},
    { status: ["applied"], campaign: campaign(), pending_streams: [] },
    { status: "applied", campaign: campaign(), pending_streams: [] },
    { status: "failed", campaign: campaign(), pending_streams: [] },
    { status: "unknown", campaign: null, pending_streams: [] },
    {
      status: "partial",
      campaign: { ...campaign(), id: 8 },
      pending_streams: [proposal],
    },
    {
      status: "failed",
      campaign: campaign(),
      pending_streams: [{ ...proposal, pinned_offer_ids: [] }],
    },
  ]) {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(pushCampaign(7, [proposal]));
    mock.restoreAll();
  }
});

test("network and invalid JSON failures do not trigger retries", async () => {
  for (const response of [null, new Response("invalid")]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      if (!response) throw new TypeError("offline");
      return response;
    });
    await assert.rejects(pushCampaign(7, [proposal]));
    assert.equal(fetchMock.mock.callCount(), 1);
    mock.restoreAll();
  }
});
